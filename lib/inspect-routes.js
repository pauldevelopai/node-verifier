// Inspect routes — the /api/inspect surface used by Verify mode to track WHERE a
// social-media post came from and whether the account looks dangerous/fake.
//
// Facebook-only for now (the platform the newsroom is fighting). Native JS, no
// scraping deps: identify the account from the URL, best-effort OpenGraph fetch,
// and a transparent heuristic risk panel. The journalist's "add context" form
// (Page Transparency fields) sharpens the heuristics — see lib/facebook.js.
//
//   Local  (index.js):        mountInspectRoutes(app, () => host)
//   Hosted (server-hosted.js): mountInspectRoutes(app, hostFor)   // per request
//   MCP    (mcp-server.js):   inspectUrl(host, { url, context })  // same logic

import crypto from 'node:crypto';
import { parseFacebookUrl, fetchFacebookMeta, accountRiskSignals, resolveFacebookShare, OBSCURED_KINDS } from './facebook.js';
import { enrichmentStatus, enrichFacebookAccount, fetchRecentPosts, lookupPoliticalAds, mergeContext, apifyResolvePost } from './enrich.js';

// Stable id for an origin result, derived from the canonical account/post URL, so
// re-tracking the same link UPDATES one stored record instead of piling up rows.
const originIdFor = (key) => 'fb-' + crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 12);

// The origin-tracking action itself, as a plain (host, args) → result function —
// the same contract as the standard handlers, so it can be called from the
// express route below AND projected as an MCP tool (mcp-server.js).
export async function inspectUrl(host, { url, context = {} } = {}) {
  if (!url || typeof url !== 'string') {
    return { ok: false, error: 'no_url', message: 'Provide a social-media post URL to inspect.' };
  }

  let parsed = parseFacebookUrl(url);
  if (!parsed.isFacebook) {
    return {
      ok: true,
      platform: 'other',
      supported: false,
      message: 'Origin tracking currently supports Facebook links only. The URL is still passed to the verification step as-is.',
      parsed,
    };
  }

  // Obscured share/watch/reel link → recover the real post + author.
  let resolution = null;
  if (OBSCURED_KINDS.has(parsed.kind)) {
    // 1) Free path: mbasic 302s the token to the canonical URL before the wall.
    resolution = await resolveFacebookShare(url);

    // 2) Facebook now login-walls mbasic for most share tokens, so it fails.
    //    When a scraper token is configured, resolve the obscured link through
    //    Apify's post scraper — it reads the post (and its author) from the
    //    token as public data. Cached per-URL (TTL) so re-tracking is free.
    let apifyResolved = null;
    if (!resolution.resolved && enrichmentStatus().apify) {
      const ttlMs = (Number(process.env.ENRICH_CACHE_TTL_HOURS) || 24) * 3600000;
      const rk = `resolve:${url}`;
      const hit = await host.store?.get('enrich_cache', rk).catch(() => null);
      if (hit && hit.cachedAt && (Date.now() - Date.parse(hit.cachedAt)) < ttlMs) {
        apifyResolved = hit.resolved || null;
      } else {
        apifyResolved = await apifyResolvePost(url).catch(() => null);
        await host.store?.put('enrich_cache', rk, { resolved: apifyResolved, cachedAt: new Date().toISOString() }).catch(() => {});
      }
      if (apifyResolved) {
        resolution = { resolved: true, url: apifyResolved.canonicalUrl || url, via: 'apify_post' };
        await host.log.run({ op: 'inspect_resolve_apify', had_author: !!apifyResolved.author?.name, had_canonical: !!apifyResolved.canonicalUrl });
      }
    }

    // 3) If we recovered a canonical post URL, re-parse THAT so the account is
    //    named and downstream page-transparency enrichment can run on it.
    if (resolution.resolved) {
      const reparsed = parseFacebookUrl(resolution.url);
      if (reparsed.isFacebook && !OBSCURED_KINDS.has(reparsed.kind)) {
        reparsed.resolvedFromShare = url;
        reparsed.notes = [
          `Resolved the share link → ${reparsed.kind.replace(/_/g, ' ')} (${resolution.url}).`,
          ...(reparsed.notes || []),
        ];
        // We DID resolve the origin — drop the "obscured/origin not in URL" signals.
        reparsed.signals = (reparsed.signals || []).filter((s) => s !== 'origin_obscured_share' && s !== 'origin_not_in_url');
        parsed = reparsed;
      }
    }

    // 4) Apify named the author but the URL still doesn't (no clean canonical) —
    //    graft the resolved author on directly so the risk panel and the display
    //    show the real account instead of "hidden behind a redirect token".
    if (apifyResolved?.author?.name && OBSCURED_KINDS.has(parsed.kind) && !parsed.account?.url) {
      const a = apifyResolved.author;
      parsed.account = {
        type: a.type || 'unknown',
        handle: null,
        numericId: a.id && /^\d+$/.test(String(a.id)) ? String(a.id) : null,
        displayHint: a.name,
        url: a.url || null,
      };
      parsed.signals = (parsed.signals || []).filter((s) => s !== 'origin_obscured_share' && s !== 'origin_not_in_url');
      parsed.notes.unshift(`Resolved via Apify → ${a.name}${a.type ? ` (${a.type})` : ''}.`);
      parsed.isPermalink = true;
      if (apifyResolved.postTime) parsed.resolvedPostTime = apifyResolved.postTime;
      if (apifyResolved.text) parsed.resolvedPostText = apifyResolved.text;
    }
  }

  // Best-effort meta — expected to be blocked by Facebook's login wall for most
  // post URLs; we surface that honestly rather than pretending we read the page.
  const meta = await fetchFacebookMeta(parsed.account?.url || parsed.normalizedUrl || url);

  // Hosted-only enrichment (behind server tokens). Auto-fills the context the
  // journalist would otherwise type by hand; their explicit entries still win.
  // Absent any token → enrichment/ads are null and we fall back to manual.
  const status = enrichmentStatus();
  let enrichment = null;
  let ads = null;
  let posts = [];
  let merged = { ...(context || {}) };
  let enrichCacheHit = false;

  if (status.apify || status.brightdata || status.adlibrary) {
    // The scrapers cost money per run, and page-transparency data changes slowly,
    // so cache the bundle per page/post and reuse it within a TTL. Re-inspecting
    // any post from the same page (or the same post twice) then costs nothing.
    const cacheKey = parsed.account?.url || parsed.normalizedUrl || url;
    const ttlMs = (Number(process.env.ENRICH_CACHE_TTL_HOURS) || 24) * 3600000;
    const hit = await host.store?.get('enrich_cache', cacheKey).catch(() => null);
    if (hit && hit.cachedAt && (Date.now() - Date.parse(hit.cachedAt)) < ttlMs) {
      enrichment = hit.enrichment || null;
      posts = hit.posts || [];
      ads = hit.ads || null;
      enrichCacheHit = true;
    } else {
      if (status.apify || status.brightdata) {
        const [acct, recent] = await Promise.all([
          enrichFacebookAccount(parsed),
          (status.apify && parsed.account?.url) ? fetchRecentPosts(parsed).catch(() => []) : Promise.resolve([]),
        ]);
        enrichment = acct;
        posts = recent || [];
      }
      if (status.adlibrary) {
        // Ad Library only needs the page id (from enrichment) — not the journalist's context.
        ads = await lookupPoliticalAds(parsed, { page_id: enrichment?.fields?.page_id });
      }
      await host.store?.put('enrich_cache', cacheKey, {
        enrichment, posts, ads, cachedAt: new Date().toISOString(),
      }).catch(() => {});
      if (enrichment?.fields) {
        await host.log.run({ op: 'inspect_enrich', source: enrichment.source, fields: Object.keys(enrichment.fields), posts: posts.length });
      }
    }

    // Per-request merge + flags (runs for both cached and fresh; depends on the
    // journalist's context, which is never cached).
    if (enrichment?.fields) {
      merged = mergeContext(enrichment.fields, context);
      if (enrichment.fields.display_name && !parsed.account?.displayHint && !parsed.account?.handle) {
        parsed.account = { ...(parsed.account || {}), displayHint: enrichment.fields.display_name };
        if (enrichment.fields.account_type) parsed.account.type = enrichment.fields.account_type;
      }
      if (enrichment.fields.sponsored && merged.ad_library_active === undefined) merged.ad_library_active = true;
    }
    if (ads?.ok && ads.count > 0 && merged.ad_library_active === undefined) merged.ad_library_active = true;
  }

  const risk = accountRiskSignals(parsed, merged, posts);

  // Persist the origin result so it's part of the Node's growing database AND
  // can be approved/disapproved (result_type 'origin'). Keyed by the canonical
  // URL → re-tracking the same link overwrites rather than duplicates.
  const originId = originIdFor(parsed.account?.url || parsed.normalizedUrl || url);
  await host.store?.put('origins', originId, {
    id: originId,
    tracked_at: new Date().toISOString(),
    url, kind: parsed.kind,
    account: parsed.account || null,
    notes: parsed.notes || [],
    risk_summary: risk.summary || null,
    risk_counts: risk.counts || null,
    context: merged,
    enrich_source: enrichment?.source || null,
  }).catch(() => {});

  await host.log.run({
    op: 'inspect_url', platform: 'facebook', kind: parsed.kind,
    share_resolved: !!resolution?.resolved,
    meta_blocked: !!meta.blocked, enriched: !!enrichment, enrich_source: enrichment?.source || null,
    enrich_cached: enrichCacheHit,
    posts_sampled: posts.length, ads_found: ads?.count || 0,
    risk_flags: risk.counts.total, risk_significant: risk.counts.significant,
  });

  return {
    ok: true, platform: 'facebook', supported: true,
    origin_id: originId,
    parsed, meta, risk,
    resolution,
    context: merged,
    enrichment: enrichment ? { source: enrichment.source, fields: enrichment.fields } : null,
    posts_sampled: posts.length,
    ads,
    enrichment_status: { apify: status.apify, brightdata: status.brightdata, adlibrary: status.adlibrary },
    enrich_cached: enrichCacheHit,
  };
}

export function mountInspectRoutes(app, getHost) {
  const wrap = (fn) => async (req, res) => {
    let host;
    try {
      host = getHost(req);
      res.json(await fn(req, host));
    } catch (err) {
      console.error('inspect route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'inspect error' });
      try { await host?.log?.error?.({ op: req.path, error: err, context: { method: req.method } }); }
      catch { /* swallow */ }
    }
  };

  // POST /api/inspect  { url, context? } → { ok, platform, parsed, meta, risk }
  app.post('/api/inspect', wrap((req, host) => inspectUrl(host, req.body || {})));
}
