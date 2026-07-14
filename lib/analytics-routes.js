// Analytics route — the /api/analytics surface. One aggregated, read-only
// snapshot of everything the Node has produced, for the Dashboard panel:
// claims submitted, how many verified, how much misinformation was caught, and
// the day-by-day trend over the election window.
//
//   Local  (index.js):         mountAnalyticsRoutes(app, () => host)
//   Hosted (server-hosted.js): mountAnalyticsRoutes(app, hostFor)   // per request
//
// Storage is host.store, so it reads identically on a laptop and hosted. Every
// number here is derived from real stored records — no synthetic data, honest
// zeros when a newsroom hasn't run anything yet (Grounded hard rule).

const TREND_DAYS = 30;

// A record's day bucket (UTC YYYY-MM-DD) from whatever timestamp field it carries.
function dayOf(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function listValues(host, collection) {
  try {
    const items = await host.store.list(collection);
    return items.map((i) => i.value).filter(Boolean);
  } catch {
    return [];
  }
}

// Count a claim's tier into the four canonical buckets. Misinformation caught =
// LIKELY FALSE + CONTESTED (both are "this doesn't hold up"); VERIFIED = stood up.
function emptyTiers() {
  return { VERIFIED: 0, CONTESTED: 0, 'LIKELY FALSE': 0, 'INSUFFICIENT EVIDENCE': 0 };
}

export function mountAnalyticsRoutes(app, getHost) {
  app.get('/api/analytics', async (req, res) => {
    try {
      const host = getHost(req);
      const [claims, posts, origins, comparisons] = await Promise.all([
        listValues(host, 'claims'),
        listValues(host, 'posts'),
        listValues(host, 'origins'),
        listValues(host, 'comparisons'),
      ]);

      // ── Verify-mode totals ──────────────────────────────────────────
      const byTier = emptyTiers();
      let withImage = 0;
      let withSource = 0;
      for (const c of claims) {
        const t = c.report?.tier;
        if (t && byTier[t] !== undefined) byTier[t]++;
        if (c.had_image) withImage++;
        if (c.source_url) withSource++;
      }
      const misinformation = byTier['LIKELY FALSE'] + byTier.CONTESTED;

      // ── Day-by-day trend (last TREND_DAYS, zero-filled) ─────────────
      // Anchored to the most recent activity so the window always shows the
      // election period the newsroom is actually working in, not a dead tail.
      const allDays = [
        ...claims.map((c) => dayOf(c.timestamp)),
        ...posts.map((p) => dayOf(p.analyzed_at)),
      ].filter(Boolean).sort();
      const anchor = allDays.length ? new Date(allDays[allDays.length - 1] + 'T00:00:00Z') : new Date();

      const buckets = new Map(); // date → { date, claims, misinformation, posts }
      for (let i = TREND_DAYS - 1; i >= 0; i--) {
        const d = new Date(anchor);
        d.setUTCDate(d.getUTCDate() - i);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { date: key, claims: 0, misinformation: 0, posts: 0 });
      }
      for (const c of claims) {
        const b = buckets.get(dayOf(c.timestamp));
        if (!b) continue;
        b.claims++;
        const t = c.report?.tier;
        if (t === 'LIKELY FALSE' || t === 'CONTESTED') b.misinformation++;
      }
      for (const p of posts) {
        const b = buckets.get(dayOf(p.analyzed_at));
        if (b) b.posts++;
      }
      const daily = Array.from(buckets.values());

      // ── This-week vs last-week (impact read for the election window) ─
      const window = (offsetDays) => {
        const end = new Date(anchor);
        end.setUTCDate(end.getUTCDate() - offsetDays);
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - 6);
        const s = start.toISOString().slice(0, 10);
        const e = end.toISOString().slice(0, 10);
        let cl = 0;
        let mis = 0;
        for (const c of claims) {
          const day = dayOf(c.timestamp);
          if (!day || day < s || day > e) continue;
          cl++;
          const t = c.report?.tier;
          if (t === 'LIKELY FALSE' || t === 'CONTESTED') mis++;
        }
        return { claims: cl, misinformation: mis };
      };
      const last7 = window(0);
      const prev7 = window(7);

      res.json({
        ok: true,
        generated_at: new Date().toISOString(),
        verify: {
          total_claims: claims.length,
          verified: byTier.VERIFIED,
          misinformation_caught: misinformation,
          by_tier: byTier,
          with_image: withImage,
          with_source: withSource,
        },
        listen: {
          posts_analyzed: posts.length,
          origins_tracked: origins.length,
          comparisons_run: comparisons.length,
        },
        trend: { days: TREND_DAYS, daily },
        recent: { last7, prev7 },
      });
    } catch (err) {
      console.error('analytics route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'analytics error' });
    }
  });
}
