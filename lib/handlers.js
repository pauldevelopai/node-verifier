// Route handlers — the standard /api/* surface, auto-mounted by the runtime
// (createServer locally, createHostedServer online). Each takes the host facade
// + a request-like object and returns a plain object (the JSON response).
//
// Storage is host.store, so these run identically on a laptop (JSON files) and
// hosted (per-newsroom Postgres). The only filesystem touch is local API-key
// setup; when hosted (process.env.GROUNDED_HOSTED) the key is server-managed.

import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { verifyClaim } from './verifier.js';
import { loadCorpus } from './corpus.js';

const ACTIVITY_LOG = './data/processed/node_capitalfm_verifier_activity.json';
const ENV_PATH = '.env';
const HOSTED = () => !!process.env.GROUNDED_HOSTED;

// ─── Local API-key setup (laptop only) ───────────────────────────────
function readEnvFile() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}
function writeEnvFile(updates) {
  const merged = { ...readEnvFile(), ...updates };
  const order = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'MODEL', 'OPENAI_BASE_URL', 'NEWSROOM', 'PORT'];
  const lines = [
    '# Saved by the in-app setup screen. Update through the app, not by editing this.',
    '# Keep this file private — it contains your API key. (Already in .gitignore.)',
    '',
  ];
  for (const k of order) if (merged[k] !== undefined && merged[k] !== '') lines.push(`${k}=${merged[k]}`);
  for (const k of Object.keys(merged)) if (!order.includes(k) && merged[k]) lines.push(`${k}=${merged[k]}`);
  writeFileSync(ENV_PATH, lines.join('\n') + '\n');
  for (const [k, v] of Object.entries(updates)) { if (v) process.env[k] = v; else delete process.env[k]; }
}

/** GET — has an API key been configured? (Hosted: the server manages it.) */
export async function getSetupStatus() {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const explicit = (process.env.AI_PROVIDER || '').toLowerCase();
  let activeProvider = null;
  if (explicit === 'anthropic' || explicit === 'openai') activeProvider = explicit;
  else if (hasAnthropic) activeProvider = 'anthropic';
  else if (hasOpenAI) activeProvider = 'openai';
  return {
    configured: HOSTED() ? true : !!activeProvider,
    serverManaged: HOSTED(),
    activeProvider: activeProvider || (HOSTED() ? 'anthropic' : null),
    hasAnthropicKey: hasAnthropic,
    hasOpenAIKey: hasOpenAI,
  };
}

/** POST — save provider + key to .env (laptop only). */
export async function postSetup(host, body) {
  if (HOSTED()) {
    return { ok: false, serverManaged: true, message: 'When run online the AI key is managed by the server — nothing to set here.' };
  }
  const { provider, apiKey } = body || {};
  if (provider === null && apiKey === null) {
    writeEnvFile({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AI_PROVIDER: '' });
    return { ok: true, reset: true };
  }
  if (!['anthropic', 'openai'].includes(provider)) return { ok: false, message: 'Pick Anthropic or OpenAI.' };
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) return { ok: false, message: 'Paste your API key into the key box.' };
  const key = apiKey.trim();
  const updates = { AI_PROVIDER: provider };
  if (provider === 'anthropic') updates.ANTHROPIC_API_KEY = key; else updates.OPENAI_API_KEY = key;
  writeEnvFile(updates);
  await host.log.run({ op: 'setup', provider, success: true });
  return { ok: true, provider };
}

// ─── Reading state ──────────────────────────────────────────────────
export async function listSources(host) {
  const examples = await loadCorpus(host);
  return {
    corpus_size: examples.length,
    files: examples.map((e) => ({ filename: e.filename, bytes: e.content.length })),
  };
}

export async function getReport(host) {
  const claims = await readClaims(host);
  return { total_claims_checked: claims.length, recent: claims.slice(-20).reverse() };
}

export async function getQuality(host) {
  const claims = await readClaims(host);
  const tiers = { VERIFIED: 0, CONTESTED: 0, 'LIKELY FALSE': 0, 'INSUFFICIENT EVIDENCE': 0 };
  for (const c of claims) if (c.report?.tier && tiers[c.report.tier] !== undefined) tiers[c.report.tier]++;
  return {
    total_claims_checked: claims.length,
    by_tier: tiers,
    last_check: claims.length ? claims[claims.length - 1].timestamp : null,
  };
}

export async function getActivity() {
  // Local only: read the lite host's activity file. Hosted activity lives in
  // Postgres (no fs file) → returns [] gracefully.
  try { return JSON.parse(await fs.readFile(ACTIVITY_LOG, 'utf8')); } catch { return []; }
}

// ─── Verify a claim — the main action ───────────────────────────────
export async function postBrief(host, body) {
  const { claimText, imageBase64, imageMimeType, sourceUrl } = body;
  if (!claimText && !imageBase64) {
    return { ok: false, error: 'no_input', message: 'Provide claim text, an image, or both.' };
  }
  await host.log.run({ op: 'verify_claim_start', has_text: !!claimText, has_image: !!imageBase64, has_source_url: !!sourceUrl });
  const result = await verifyClaim(host, { claimText, imageBase64, imageMimeType, sourceUrl });
  await host.log.run({ op: 'verify_claim_done', ok: result.ok, tier: result.report?.tier, corpus_size: result.corpus_size });
  if (result.ok) {
    const key = `${result.timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    await host.store.put('claims', key, {
      timestamp: result.timestamp,
      claim_text: claimText || null,
      had_image: !!imageBase64,
      source_url: sourceUrl || null,
      report: result.report,
    });
  }
  return result;
}

// ─── Ingest — add a training example to the corpus ──────────────────
export async function postIngest(host, body) {
  // Accept either a direct JSON body { filename, content } or the runtime's
  // file-upload shape { buffer, sourceLabel } — so a newsroom can add a corpus
  // example by uploading a .txt file (the only way online, where there's no
  // folder to drop files into).
  let { filename, content } = body || {};
  if (!content && body && body.buffer) {
    content = Buffer.isBuffer(body.buffer) ? body.buffer.toString('utf8') : String(body.buffer);
    filename = filename || body.sourceLabel;
  }
  if (!filename || !content) return { ok: false, error: 'missing_fields', message: 'Provide a filename and text (or upload a .txt file).' };
  let safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!safeName.toLowerCase().endsWith('.txt')) safeName += '.txt';
  await host.store.put('corpus', safeName, String(content));
  await host.log.run({ op: 'corpus_add', filename: safeName, bytes: String(content).length });
  return { ok: true, filename: safeName };
}

// ─── Internal ───────────────────────────────────────────────────────
// Claims keyed by timestamp, so store.list returns them in chronological order.
async function readClaims(host) {
  const items = await host.store.list('claims');
  return items.map((i) => i.value).filter(Boolean);
}
