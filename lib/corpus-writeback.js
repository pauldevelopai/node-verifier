// Write-back into the SHARED GROUNDED corpus.
//
// Everything Election Watch produces already persists to host.store — durable,
// per-newsroom, in Postgres. But that is a Node-local silo: nothing else on the
// platform can query it, cite it, export it or learn from it. The vision's rule
// is that a Node's real output is the data it leaves behind in the shared layer,
// so a claim check writes twice.
//
// TWO RECORDS, because they answer different questions.
//
//   misinformation_record  the claim itself. What circulated, in which
//                          jurisdiction, which tier, and what the journalist
//                          eventually decided. This is the Zambian election
//                          misinformation archive, and it outlives the app.
//
//   newsroom_ai            the practice signal, written only when a human rules.
//                          "A newsroom used AI to check a claim, and the
//                          journalist agreed / overruled it." Adoption data with
//                          an OUTCOME attached — the rarest and most useful kind,
//                          and the thing that lets us say how often the AI was
//                          right rather than how often it was used.
//
// THE VERIFICATION CONTRACT FALLS OUT FOR FREE. The corpus wants records born
// `ai_drafted` and flipped to `human_verified` only by a named person. That is
// exactly what the judgments loop already does — a journalist approving a result
// IS the named human verification. So we do not invent a parallel workflow; we
// mirror the one that exists.
//
// EVERY CALL IS BEST-EFFORT AND GUARDED. host.corpus only exists on runtime
// v0.16.0+, and the box may be older. A missing corpus API, or a failed write,
// must never cost a journalist their verification result — the claim is already
// safe in host.store either way.

const JURISDICTION = process.env.NEWSROOM_JURISDICTION || 'ZM';
const LANGUAGE = process.env.NEWSROOM_LANGUAGE || 'en';

/**
 * Older runtimes have no corpus API. Callers must not care — but somebody has to
 * be told, or a Node pinned to an old runtime looks like it is contributing to
 * the corpus while quietly writing nothing. An empty corpus is not a passing
 * test, so say it out loud (once) instead of failing silently.
 */
let warnedNoCorpus = false;
function corpusOf(host) {
  if (host && host.corpus && typeof host.corpus.add === 'function') return host.corpus;
  if (!warnedNoCorpus) {
    warnedNoCorpus = true;
    console.warn('[corpus] this runtime has no host.corpus — Election Watch results are '
      + 'saving to host.store but NOT to the shared GROUNDED corpus. '
      + 'Upgrade the Node to grounded-node-runtime v0.17.1 or newer.');
  }
  return null;
}

function shorten(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/**
 * The corpus dedups on source_url, and that is the right rule for the corpus —
 * but it means `add` can hand back a record that belongs to something else.
 *
 * A single Facebook post can carry several distinct claims, so two claim checks
 * legitimately share one source_url. If we linked the second claim to the first
 * claim's record, a journalist approving the second would stamp `human_verified`
 * on a record describing the first — a wrong attribution on exactly the field
 * that exists to make attribution trustworthy.
 *
 * So we only keep the link when the returned record really is about this thing:
 * a fresh insert always is, and an existing one is when `matches` says so. When
 * it isn't, we return null — the check still lives in host.store, and a later
 * judgment writes the practice signal without flipping anyone else's record.
 */
async function linkableId(corpus, res, matches) {
  if (!res?.id) return null;
  if (res.inserted) return res.id;
  try {
    const existing = await corpus.get(res.id);
    return existing && matches(existing) ? res.id : null;
  } catch {
    return null;
  }
}

/**
 * A completed claim check → one ai_drafted misinformation record.
 * Returns the corpus record id (so the judgment can verify it later) or null.
 */
export async function recordClaimChecked(host, { claimId, claimText, sourceUrl, report, citations, accountOrigin }) {
  const corpus = corpusOf(host);
  if (!corpus) return null;
  try {
    const res = await corpus.add({
      collection: 'misinformation_record',
      // The AI's neutral restatement is a better title than raw claim text,
      // which is often a screenshot caption or a WhatsApp forward.
      title: shorten(report?.claim_restated || claimText || 'Untitled claim', 300),
      source_url: sourceUrl || null,
      date: new Date().toISOString().slice(0, 10),
      jurisdiction: JURISDICTION,
      language: LANGUAGE,
      summary: shorten(report?.tier_reason, 1000) || null,
      entity: accountOrigin?.page_name || accountOrigin?.url || null,
      // Born ai_drafted. The journalist's approval is what makes it verified.
      verification_status: 'ai_drafted',
      // The tier IS the outcome — the vision's "outcome data is the most
      // valuable thing we collect", available here on every single record.
      outcome: report?.tier || null,
      extra: {
        node: 'election-watch',
        claim_id: claimId,
        claim_text: claimText || null,
        reasoning_chain: report?.reasoning_chain || [],
        further_checks: report?.further_checks || [],
        key_sources: report?.key_sources || [],
        matching_examples: report?.matching_examples || [],
        web_citations: citations || [],
        account_origin: accountOrigin || null,
      },
    });
    // A claim's identity is its text, not the URL it was found at.
    return await linkableId(corpus, res, (row) => row.extra?.claim_text === (claimText || null));
  } catch (err) {
    // Never let a corpus problem cost the journalist their result.
    console.error('[corpus] claim write-back failed:', err.message);
    return null;
  }
}

/**
 * A completed Listen-mode origin analysis → one ai_drafted misinformation record.
 *
 * Same corpus as a claim check, because it answers the same question from the
 * other end: a claim check asks "is this true?", an origin analysis asks "where
 * did this come from and does the account look coordinated?". Both are evidence
 * about what circulated in a jurisdiction, and the coordination signals are the
 * part no other corpus on the platform holds.
 *
 * Returns the corpus record id (so a later judgment can verify it) or null.
 */
export async function recordPostAnalysed(host, { postId, postText, postUrl, pageUrl, profile, page }) {
  const corpus = corpusOf(host);
  if (!corpus) return null;
  try {
    const res = await corpus.add({
      collection: 'misinformation_record',
      title: shorten(profile?.post_restated || postText || 'Untitled post', 300),
      source_url: postUrl || pageUrl || null,
      date: new Date().toISOString().slice(0, 10),
      jurisdiction: JURISDICTION,
      language: LANGUAGE,
      summary: shorten(profile?.confidence_reason, 1000) || null,
      entity: page?.name || pageUrl || null,
      verification_status: 'ai_drafted',
      // The confidence label is the outcome: how coordinated this looked.
      outcome: profile?.confidence || null,
      extra: {
        node: 'election-watch',
        function: 'origin_analysis',
        post_id: postId,
        post_text: postText || null,
        page_url: pageUrl || null,
        page_admin_country: page?.admin_country || null,
        flags: profile?.flags || [],
        why_chain: profile?.why_chain || [],
        further_checks: profile?.further_checks || [],
        what_not_to_publish: profile?.what_NOT_to_publish || null,
        editorial_lead: profile?.editorial_lead || null,
      },
    });
    // A post's identity IS its URL, so re-analysing the same post should land on
    // the same record. With no URL to key on, only a fresh insert is ours.
    return await linkableId(corpus, res, (row) => !!postUrl && row.source_url === postUrl);
  } catch (err) {
    console.error('[corpus] post write-back failed:', err.message);
    return null;
  }
}

/**
 * A journalist's verdict → verify the claim record, and write the practice
 * signal to newsroom_ai.
 *
 * `verifiedBy` must be a real person. If we cannot name one we do NOT flip the
 * record — an unattributed "human_verified" is worse than none, and the corpus
 * rejects it anyway.
 */
export async function recordJudgmentToCorpus(host, {
  corpusRecordId, verdict, verifiedBy, claimText, aiTier, correction, kind = 'claim check',
}) {
  const corpus = corpusOf(host);
  if (!corpus) return;
  const agreed = verdict === 'approve';

  // 1. Approval is the named human verification the corpus contract asks for.
  if (corpusRecordId && agreed && verifiedBy && typeof corpus.verify === 'function') {
    try {
      await corpus.verify(corpusRecordId, verifiedBy);
    } catch (err) {
      console.error('[corpus] verify failed:', err.message);
    }
  }

  // 2. The practice signal — did the AI get it right, and what did the human do?
  try {
    await corpus.add({
      collection: 'newsroom_ai',
      title: shorten(`Election Watch ${kind} ${agreed ? 'confirmed' : 'overruled'} by a journalist`, 300),
      date: new Date().toISOString().slice(0, 10),
      jurisdiction: JURISDICTION,
      language: LANGUAGE,
      entity: 'Election Watch',
      // This record is itself a human observation, so it is verified on arrival
      // — but only when we can name who made it.
      verification_status: verifiedBy ? 'human_verified' : 'ai_drafted',
      verified_by: verifiedBy || null,
      // agreed / overruled: the adoption outcome, which is the point of this row.
      outcome: agreed ? 'agreed' : 'overruled',
      summary: shorten(
        `A journalist ${agreed ? 'agreed with' : 'overruled'} an AI ${kind} the model labelled "${aiTier || 'unlabelled'}".`
        + (correction ? ` Correction: ${correction}` : ''), 1000),
      extra: {
        node: 'election-watch',
        function: kind.replace(/\s+/g, '_'),
        ai_tier: aiTier || null,
        journalist_verdict: verdict,
        correction: correction || null,
        claim_excerpt: shorten(claimText, 300) || null,
        misinformation_record_id: corpusRecordId || null,
      },
    });
  } catch (err) {
    console.error('[corpus] practice write-back failed:', err.message);
  }
}
