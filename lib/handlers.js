// Route handlers — auto-mounted by the runtime's createServer.
//
// The shape of each handler matches the standard contract documented
// in grounded-node-runtime: takes the host facade and a request-like
// object, returns a plain object that becomes the JSON response body.

import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyClaim } from './verifier.js';
import { loadCorpus } from './corpus.js';

const CLAIMS_LOG = './data/processed/capitalfm-verifier-claims.json';

// ─── Setup ──────────────────────────────────────────────────────────

export async function getSetupStatus(host) {
  // Defer to the runtime's standard setup-status check.
  return host.setup.status();
}

export async function postSetup(host, { provider, apiKey }) {
  return host.setup.save({ provider, apiKey });
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
  return host.log.read();
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
