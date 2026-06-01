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

import { parseFacebookUrl, fetchFacebookMeta, accountRiskSignals } from './facebook.js';
import { enrichmentStatus, enrichFacebookAccount, lookupPoliticalAds, mergeContext } from './enrich.js';

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

    const parsed = parseFacebookUrl(url);
    if (!parsed.isFacebook) {
      return {
        ok: true,
        platform: 'other',
        supported: false,
        message: 'Origin tracking currently supports Facebook links only. The URL is still passed to the verification step as-is.',
        parsed,
      };
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
    let merged = { ...(context || {}) };

    if (status.apify || status.brightdata) {
      enrichment = await enrichFacebookAccount(parsed);
      if (enrichment?.fields) {
        merged = mergeContext(enrichment.fields, context);
        await host.log.run({ op: 'inspect_enrich', source: enrichment.source, fields: Object.keys(enrichment.fields) });
      }
    }
    if (status.adlibrary) {
      ads = await lookupPoliticalAds(parsed, merged);
      // A page running political ads → trip the existing paid-amplification flag
      // (unless the journalist explicitly set it).
      if (ads?.ok && ads.count > 0 && merged.ad_library_active === undefined) merged.ad_library_active = true;
    }

    const risk = accountRiskSignals(parsed, merged);

    await host.log.run({
      op: 'inspect_url', platform: 'facebook', kind: parsed.kind,
      meta_blocked: !!meta.blocked, enriched: !!enrichment, enrich_source: enrichment?.source || null,
      ads_found: ads?.count || 0, risk_flags: risk.counts.total, risk_significant: risk.counts.significant,
    });

    return {
      ok: true, platform: 'facebook', supported: true,
      parsed, meta, risk,
      context: merged,
      enrichment: enrichment ? { source: enrichment.source, fields: enrichment.fields } : null,
      ads,
      enrichment_status: { apify: status.apify, brightdata: status.brightdata, adlibrary: status.adlibrary },
    };
  }));
}
