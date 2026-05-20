// Route handlers — auto-mounted by the runtime's createServer.
//
// The shape of each handler matches the standard contract documented
// in grounded-node-runtime: takes the host facade and a request-like
// object, returns a plain object that becomes the JSON response body.

import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { verifyClaim } from './verifier.js';
import { loadCorpus } from './corpus.js';

const CLAIMS_LOG = './data/processed/capitalfm-verifier-claims.json';
const ACTIVITY_LOG = './data/processed/node_capitalfm_verifier_activity.json';
const ENV_PATH = '.env';

// ─── Setup: in-app API-key configuration ─────────────────────────────
// Newsroom never has to edit .env by hand. Frontend calls getSetupStatus
// to decide whether to show the welcome form or the dashboard; postSetup
// writes the chosen key to .env and updates process.env in-process so
// the next AI call works without restarting the app. Same pattern as
// node-makanday-analytics.

function readEnvFile() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function writeEnvFile(updates) {
  const current = readEnvFile();
  const merged = { ...current, ...updates };
  const order = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'MODEL', 'OPENAI_BASE_URL', 'NEWSROOM', 'PORT'];
  const lines = [
    '# Saved by the in-app setup screen. Update through the app, not by editing this.',
    '# Keep this file private — it contains your API key. (Already in .gitignore.)',
    '',
  ];
  for (const k of order) {
    if (merged[k] !== undefined && merged[k] !== '') lines.push(`${k}=${merged[k]}`);
  }
  for (const k of Object.keys(merged)) {
    if (!order.includes(k) && merged[k]) lines.push(`${k}=${merged[k]}`);
  }
  writeFileSync(ENV_PATH, lines.join('\n') + '\n');
  // Apply live so the next chat() call picks up the new key without restart.
  for (const [k, v] of Object.entries(updates)) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
}

/** GET — has the newsroom configured an API key yet? */
export async function getSetupStatus(host) {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const explicit = (process.env.AI_PROVIDER || '').toLowerCase();
  let activeProvider = null;
  if (explicit === 'anthropic' || explicit === 'openai') activeProvider = explicit;
  else if (hasAnthropic) activeProvider = 'anthropic';
  else if (hasOpenAI) activeProvider = 'openai';
  return {
    configured: !!activeProvider,
    activeProvider,
    hasAnthropicKey: hasAnthropic,
    hasOpenAIKey: hasOpenAI,
  };
}

/** POST — save the chosen provider + API key to .env. */
export async function postSetup(host, body) {
  const { provider, apiKey } = body || {};
  // Reset path (frontend sends null/null when user wants to re-enter the key)
  if (provider === null && apiKey === null) {
    writeEnvFile({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_PROVIDER: '' });
    return { ok: true, reset: true };
  }
  if (!['anthropic', 'openai'].includes(provider)) {
    return { ok: false, message: 'Pick Anthropic or OpenAI.' };
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return { ok: false, message: 'Paste your API key into the key box.' };
  }
  const key = apiKey.trim();
  const updates = { AI_PROVIDER: provider };
  if (provider === 'anthropic') updates.ANTHROPIC_API_KEY = key;
  else updates.OPENAI_API_KEY = key;
  writeEnvFile(updates);
  await host.log.run({ op: 'setup', provider, success: true });
  return { ok: true, provider };
}

// ─── Reading state ──────────────────────────────────────────────────

export async function listSources(host) {
  // For this Node, "sources" = the corpus of past examples.
  const examples = await loadCorpus();
  return {
    corpus_size: examples.length,
    files: examples.map((e) => ({ filename: e.filename, bytes: e.content.length })),
  };
}

export async function getReport(host) {
  // The "report" for this Node is the list of recent claim checks.
  const claims = await readClaimsLog();
  return {
    total_claims_checked: claims.length,
    recent: claims.slice(-20).reverse(),
  };
}

export async function getQuality(host) {
  // Simple health metrics for the dashboard.
  const claims = await readClaimsLog();
  const tiers = { VERIFIED: 0, CONTESTED: 0, 'LIKELY FALSE': 0, 'INSUFFICIENT EVIDENCE': 0 };
  for (const c of claims) {
    if (c.report?.tier && tiers[c.report.tier] !== undefined) tiers[c.report.tier]++;
  }
  return {
    total_claims_checked: claims.length,
    by_tier: tiers,
    last_check: claims.length ? claims[claims.length - 1].timestamp : null,
  };
}

export async function getActivity(host) {
  // Runtime's host.log only exposes run/edit (append-only). Read the
  // activity JSON file directly. Path matches the runtime's tableFile
  // naming: data/processed/node_<slug-with-underscores>_activity.json
  try {
    const text = await fs.readFile(ACTIVITY_LOG, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

// ─── Verifying a claim — the main action ────────────────────────────

export async function postBrief(host, body) {
  // "Brief" in this Node = verify a claim. We keep the standard route
  // name for cross-Node consistency.
  const { claimText, imageBase64, imageMimeType, sourceUrl } = body;

  if (!claimText && !imageBase64) {
    return { ok: false, error: 'no_input', message: 'Provide claim text, an image, or both.' };
  }

  await host.log.run({
    op: 'verify_claim_start',
    has_text: !!claimText,
    has_image: !!imageBase64,
    has_source_url: !!sourceUrl,
  });

  const result = await verifyClaim(host, { claimText, imageBase64, imageMimeType, sourceUrl });

  await host.log.run({
    op: 'verify_claim_done',
    ok: result.ok,
    tier: result.report?.tier,
    corpus_size: result.corpus_size,
  });

  // Persist to the claims log
  if (result.ok) {
    const claims = await readClaimsLog();
    claims.push({
      timestamp: result.timestamp,
      claim_text: claimText || null,
      had_image: !!imageBase64,
      source_url: sourceUrl || null,
      report: result.report,
    });
    await writeClaimsLog(claims);
  }

  return result;
}

// ─── Ingest — add a new training example to the corpus ──────────────

export async function postIngest(host, body) {
  // The "ingest" action for this Node = add a new training-example file.
  // Body: { filename, content }
  const { filename, content } = body;
  if (!filename || !content) {
    return { ok: false, error: 'missing_fields' };
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const filePath = path.join('./data/raw/training-examples', safeName);
  await fs.writeFile(filePath, content, 'utf8');
  await host.log.run({ op: 'corpus_add', filename: safeName, bytes: content.length });
  return { ok: true, filename: safeName };
}

// ─── Internal helpers ───────────────────────────────────────────────

async function readClaimsLog() {
  try {
    const text = await fs.readFile(CLAIMS_LOG, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function writeClaimsLog(claims) {
  await fs.mkdir(path.dirname(CLAIMS_LOG), { recursive: true });
  await fs.writeFile(CLAIMS_LOG, JSON.stringify(claims, null, 2), 'utf8');
}
