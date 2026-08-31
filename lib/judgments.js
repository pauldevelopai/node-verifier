// The learning database — Election Watch's memory of which results the newsroom
// trusted and which it corrected. THIS is what makes the Node improve over time.
//
// Every result the Node produces (a claim check, an origin track, a post
// analysis, a coordination compare) is already stored in its own collection. A
// journalist then approves or disapproves it. We record that verdict here as a
// "judgment", keyed by `<result_type>:<result_id>` so each result has exactly one
// (re-judging overwrites). The judgment carries a self-contained snapshot (the
// claim/post text + the AI's label) so it can be ranked and fed back into future
// prompts WITHOUT re-loading the source collections.
//
// Three feedback loops fire on a judgment:
//   1. Judgments memory — the relevant past verdicts are woven into the next
//      similar prompt (formatJudgmentsForPrompt + relevanceRank), so the AI
//      aligns with how the newsroom has ruled before.
//   2. Auto-corpus — an APPROVED claim/post is promoted into the trusted corpus
//      (a confirmed example), so retrieval surfaces it like any hand-added case.
//      A later disapproval removes that promoted file again.
//   3. Shared-corpus write-back (lib/corpus-writeback.js) — the verdict is the
//      named human verification the GROUNDED corpus contract asks for, and it is
//      also adoption data with an outcome attached. Loops 1 and 2 make THIS Node
//      better; loop 3 is what makes the ruling exist for the rest of GROUNDED.
//
// Storage is host.store, so this runs identically on a laptop (JSON) and hosted
// (per-newsroom Postgres).

import crypto from 'node:crypto';
import { relevanceRank } from './corpus.js';
import { recordJudgmentToCorpus } from './corpus-writeback.js';

const VERDICTS = new Set(['approve', 'disapprove']);

// Which collection backs each result type, and how to pull a snapshot out of a
// stored record of that type. snapshot.text is what we rank on; snapshot.label is
// the AI's call (tier / confidence / verdict). `promotable` = can become a
// trusted corpus example when approved (only things with a real claim/post body).
const RESULT_TYPES = {
  verify: {
    collection: 'claims',
    promotable: true,
    snapshot: (r) => ({
      text: r.claim_text || r.report?.claim_restated || '',
      label: r.report?.tier || null,
      kind: 'claim check',
    }),
  },
  origin: {
    collection: 'origins',
    promotable: false,
    snapshot: (r) => ({
      text: [r.account?.displayHint || r.account?.handle, ...(r.notes || []), r.risk_summary]
        .filter(Boolean).join(' · '),
      label: r.risk_summary || null,
      kind: 'origin track',
    }),
  },
  listen_analyze: {
    collection: 'posts',
    promotable: true,
    snapshot: (r) => ({
      text: r.post_text || r.risk_profile?.post_restated || '',
      label: r.risk_profile?.confidence || null,
      kind: 'origin analysis',
    }),
  },
  listen_compare: {
    collection: 'comparisons',
    promotable: false,
    snapshot: (r) => ({
      text: r.comparison?.summary || '',
      label: r.comparison?.verdict || null,
      kind: 'coordination compare',
    }),
  },
};

export function isKnownResultType(t) {
  return Object.prototype.hasOwnProperty.call(RESULT_TYPES, t);
}

const judgmentKey = (resultType, resultId) => `${resultType}:${resultId}`;
// Deterministic corpus filename per result, so promote→demote is idempotent.
const promotedFilename = (resultType, resultId) =>
  `confirmed-${resultType}-${crypto.createHash('sha1').update(String(resultId)).digest('hex').slice(0, 10)}.txt`;

function buildCorpusExample(snapshot, correction, when) {
  const lines = [
    `[Newsroom-confirmed example — promoted from a ${snapshot.kind} the newsroom approved on ${when.slice(0, 10)}.]`,
    '',
    snapshot.text ? snapshot.text.trim() : '(no text captured)',
  ];
  if (snapshot.label) lines.push('', `Newsroom's standing verdict: ${snapshot.label} (confirmed correct).`);
  if (correction) lines.push('', `Newsroom note: ${correction.trim()}`);
  return lines.join('\n') + '\n';
}

/**
 * Record a journalist's approve/disapprove on a result. Patches the source record
 * with `.feedback`, writes the judgment, runs the corpus promotion/demotion, and
 * writes the ruling back to the shared GROUNDED corpus.
 *
 * `verifiedBy` is the signed-in person (their email, from the tracker session).
 * It is what lets an approval flip the shared record to `human_verified` — with
 * nobody named, the record honestly stays `ai_drafted`.
 *
 * Returns { ok, judgment_id, promoted } or an { ok:false, ... } problem.
 */
export async function recordJudgment(host, { result_type, result_id, verdict, correction, verifiedBy }) {
  if (!isKnownResultType(result_type)) {
    return { ok: false, error: 'bad_result_type', message: 'Unknown result type.' };
  }
  if (!result_id) return { ok: false, error: 'no_result_id', message: 'Missing result id.' };
  if (!VERDICTS.has(verdict)) {
    return { ok: false, error: 'bad_verdict', message: 'Verdict must be approve or disapprove.' };
  }

  const spec = RESULT_TYPES[result_type];
  const record = await host.store.get(spec.collection, result_id).catch(() => null);
  if (!record) {
    return { ok: false, error: 'result_not_found', message: 'That result is no longer stored — re-run it before rating.' };
  }

  const at = new Date().toISOString();
  const snapshot = spec.snapshot(record);
  const note = (correction || '').trim() || null;

  // 1) Annotate the source record so the verdict shows on reload (History etc.).
  try {
    await host.store.put(spec.collection, result_id, { ...record, feedback: { verdict, correction: note, at } });
  } catch { /* non-fatal — the judgment below is the source of truth */ }

  // 2) Write the judgment (one per result; overwrites on re-rating).
  const judgment = { id: judgmentKey(result_type, result_id), result_type, result_id, verdict, correction: note, snapshot, at };
  await host.store.put('judgments', judgment.id, judgment);

  // 3) Auto-corpus: approve promotes, disapprove demotes (idempotent by filename).
  let promoted = false;
  if (spec.promotable && snapshot.text) {
    const fname = promotedFilename(result_type, result_id);
    if (verdict === 'approve') {
      await host.store.put('corpus', fname, buildCorpusExample(snapshot, note, at)).catch(() => {});
      promoted = true;
    } else {
      await host.store.delete('corpus', fname).catch(() => {});
    }
  }

  // 4) Shared corpus: verify the record this result created, and write the
  //    practice signal (a human agreed / overruled the AI) to newsroom_ai.
  //    `corpus_record_id` was stored on the source record when it was produced;
  //    only claim checks have one today, so the others contribute the practice
  //    signal alone. Best-effort — never costs the journalist their rating.
  await recordJudgmentToCorpus(host, {
    corpusRecordId: record.corpus_record_id || null,
    verdict,
    verifiedBy: verifiedBy || null,
    claimText: snapshot.text,
    aiTier: snapshot.label,
    correction: note,
    kind: snapshot.kind,
  });

  await host.log.run({ op: 'judgment', result_type, verdict, promoted });
  return { ok: true, judgment_id: judgment.id, promoted };
}

export async function loadJudgments(host) {
  try {
    const items = await host.store.list('judgments');
    return items.map((i) => i.value).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The relevant slice of the learning DB for a given query (claim/post text),
 * ranked by TF-IDF over each judgment's snapshot text. Empty when there's nothing
 * to learn from yet, so callers' behaviour is unchanged on a fresh install.
 */
export async function selectRelevantJudgments(host, query, k = 5) {
  const all = await loadJudgments(host);
  const usable = all.filter((j) => j.snapshot?.text);
  if (!usable.length) return [];
  return relevanceRank(usable, (j) => j.snapshot.text, query || '', k);
}

/**
 * Render judgments as a prompt block the model treats as ground-truth newsroom
 * corrections. Empty string when there are none → prompt is unchanged.
 */
export function formatJudgmentsForPrompt(judgments) {
  if (!judgments || !judgments.length) return '';
  const lines = judgments.map((j) => {
    const said = j.snapshot.label ? `you assessed it "${j.snapshot.label}"` : 'you assessed it';
    const ruling = j.verdict === 'approve'
      ? `the newsroom CONFIRMED that was correct`
      : `the newsroom marked that WRONG`;
    const note = j.correction ? ` Their note: "${j.correction}"` : '';
    return `• On a similar case ("${truncate(j.snapshot.text, 160)}") — ${said}; ${ruling}.${note}`;
  });
  return '\nThe newsroom has reviewed your earlier work. Treat the following as ground-truth corrections — when this case resembles one of them, align with the newsroom\'s ruling and apply any note they left:\n'
    + lines.join('\n') + '\n';
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
