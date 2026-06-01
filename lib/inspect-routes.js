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

import { parseFacebookUrl, fetchFacebookMeta, accountRiskSignals, resolveFacebookShare, OBSCURED_KINDS } from './facebook.js';
import { enrichmentStatus, enrichFacebookAccount, fetchRecentPosts, lookupPoliticalAds, mergeContext } from './enrich.js';

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
  app.post('/api/inspect', wrap(async (req, host) => {
    const { url, context = {} } = req.body || {};
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

    // Obscured share/watch/reel link → follow the mbasic redirect to the real
    // post, then re-parse THAT so the rest of the pipeline sees the true origin.
    let resolution = null;
    if (OBSCURED_KINDS.has(parsed.kind)) {
      resolution = await resolveFacebookShare(url);
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
      parsed, meta, risk,
      resolution,
      context: merged,
      enrichment: enrichment ? { source: enrichment.source, fields: enrichment.fields } : null,
      posts_sampled: posts.length,
      ads,
      enrichment_status: { apify: status.apify, brightdata: status.brightdata, adlibrary: status.adlibrary },
      enrich_cached: enrichCacheHit,
    };
  }));
}
