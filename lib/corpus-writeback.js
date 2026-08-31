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

// WHOSE COUNTRY, AND WHOSE NAME. Read per request from the signed-in user's
// newsroom (runtime v0.18.0 `host.meta.org`), NOT from an env var — hosted, one
// process serves every newsroom, so a single NEWSROOM_JURISDICTION would stamp a
// Kenyan newsroom's records "ZM". The env var stays as the local-install answer,
// where the install really is one newsroom.
//
// No fallback to a guess. If nobody has set the newsroom's country, jurisdiction
// is null — an honestly empty field, not a wrong one. Set it in admin.
function jurisdictionOf(host) {
  return host?.meta?.org?.country || process.env.NEWSROOM_JURISDICTION || null;
}
function languageOf() {
  return process.env.NEWSROOM_LANGUAGE || 'en';
}
/** The newsroom this record is ABOUT — never the individual user's email. */
function newsroomNameOf(host) {
  return host?.meta?.org?.name || null;
}

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
      + 'Upgrade the Node to grounded-node-runtime v0.18.0 or newer.');
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
      jurisdiction: jurisdictionOf(host),
      language: languageOf(),
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
      jurisdiction: jurisdictionOf(host),
      language: languageOf(),
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
 * A tracked Facebook account → one ai_drafted misinformation record ABOUT THE
 * SOURCE, not about a claim.
 *
 * This is the sourcing layer: who published it, whether the page hides its
 * origin behind a share token, where its admins sit, whether it runs paid ads,
 * how old it is, how fast it posts. A claim record says what was said; this says
 * where it came from. Over an election that becomes a map of the accounts
 * pushing misinformation into Zambia — the dataset a claim archive alone cannot
 * give you, because the same page turns up under a hundred different claims.
 *
 * Keyed on the ACCOUNT url, so re-tracking the same page updates one record
 * rather than piling up a row per post — the same rule the Node's own `origins`
 * store already uses.
 */
export async function recordOriginTracked(host, { originId, url, parsed, risk, context, enrichSource, ads }) {
  const corpus = corpusOf(host);
  if (!corpus) return null;

  const account = parsed?.account || null;
  const accountUrl = account?.url || null;
  const name = account?.displayHint || account?.handle || account?.numericId || null;
  try {
    const res = await corpus.add({
      collection: 'misinformation_record',
      // Named where we can name it. Where the URL hides the author (a share or
      // reel token) we say exactly that instead of inventing an account.
      title: shorten(name
        ? `Facebook ${account.type || 'account'}: ${name}`
        : `Facebook ${String(parsed?.kind || 'link').replace(/_/g, ' ')} with no identifiable account`, 300),
      // The account page is the citable thing; the post URL is the instance.
      source_url: accountUrl || parsed?.normalizedUrl || url || null,
      date: new Date().toISOString().slice(0, 10),
      jurisdiction: jurisdictionOf(host),
      language: languageOf(),
      summary: shorten(risk?.summary, 1000) || null,
      entity: name,
      verification_status: 'ai_drafted',
      // The risk summary is the assessment, so it is this record's outcome.
      outcome: risk?.summary || null,
      extra: {
        node: 'election-watch',
        function: 'origin_tracking',
        origin_id: originId,
        url_kind: parsed?.kind || null,
        account,
        // Descriptive flags with weights — never a score. The heuristics are
        // transparent by design (lib/facebook.js), so the corpus keeps the
        // observation and the reader can disagree with it.
        risk_flags: risk?.flags || [],
        risk_counts: risk?.counts || null,
        could_not_determine: risk?.could_not_determine || [],
        posting_cadence: risk?.cadence || null,
        // Page Transparency: admin country, creation date, name changes, ad
        // activity — the merge of what the scraper found and what the
        // journalist typed. This is the sourcing evidence.
        page_transparency: context || null,
        enrichment_source: enrichSource || null,
        political_ads: ads?.ok ? { count: ads.count, ads: ads.ads || [] } : null,
        url_signals: parsed?.signals || [],
        notes: parsed?.notes || [],
        resolved_from_share: parsed?.resolvedFromShare || null,
      },
    });
    return await linkableId(corpus, res, (row) => row.extra?.function === 'origin_tracking');
  } catch (err) {
    console.error('[corpus] origin write-back failed:', err.message);
    return null;
  }
}

/**
 * USE, recorded whether or not anybody rates anything.
 *
 * The judgment record below is the best adoption data we get — but it only
 * exists when a journalist bothers to press approve. A newsroom that runs four
 * hundred claim checks and never rates one would contribute NOTHING to the
 * African newsroom AI record, which is exactly the newsroom we most want to have
 * counted. So use is recorded on its own.
 *
 * ONE RECORD PER NEWSROOM PER FUNCTION PER MONTH, deduped on title+date. The
 * corpus has no counter to increment, and a row per click would drown it, so the
 * record marks that this newsroom used this function in this month. The counts
 * live in the Node's own store and activity log, which is where they belong;
 * what the corpus needs is the shape of adoption across newsrooms and time.
 */
export async function recordUsage(host, { fn, model = null, payer = null }) {
  const corpus = corpusOf(host);
  if (!corpus) return null;

  const now = new Date();
  const month = now.toISOString().slice(0, 7);          // 2026-08
  const monthStart = `${month}-01`;                      // dedup key with the title
  const newsroom = newsroomNameOf(host);
  try {
    const res = await corpus.add({
      collection: 'newsroom_ai',
      title: shorten(`${newsroom || 'A newsroom'} used Election Watch for ${fn} — ${month}`, 300),
      // No source_url deliberately: that puts dedup on (title, date), which is
      // what makes this one-per-newsroom-per-function-per-month.
      date: monthStart,
      jurisdiction: jurisdictionOf(host),
      language: languageOf(),
      entity: newsroom,
      // An observation the software made about itself. Nobody has confirmed it,
      // so it is ai_drafted like everything else born without a human.
      verification_status: 'ai_drafted',
      outcome: 'in_use',
      summary: shorten(`${newsroom || 'A newsroom'} used AI for ${fn.replace(/_/g, ' ')} `
        + `during ${month}, through Election Watch on Grounded.`, 1000),
      extra: {
        node: 'election-watch',
        tool: 'Election Watch',
        signal: 'usage',
        function: fn,
        month,
        // Whose key paid, and which model — adoption economics. "African
        // newsrooms are using AI" and "African newsrooms are PAYING for AI" are
        // different findings, and only this field separates them.
        payer,
        model,
      },
    });
    return res?.id || null;
  } catch (err) {
    console.error('[corpus] usage write-back failed:', err.message);
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
      jurisdiction: jurisdictionOf(host),
      language: languageOf(),
      // The record is ABOUT the newsroom, so the newsroom is the entity — that is
      // what makes `list({ entity })` answer "how does this newsroom use AI".
      // The tool is a property of the record, not its subject.
      entity: newsroomNameOf(host),
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
        tool: 'Election Watch',
        signal: 'judgment',
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
