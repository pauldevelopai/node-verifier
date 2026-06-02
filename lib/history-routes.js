// History route — the /api/history surface. One merged, reverse-chronological
// feed of everything the Node has produced across all four result types, each
// item carrying the FULL stored record so the UI can render its original detail
// (report, sources, origin, flags) on click without a second request.
//
//   Local  (index.js):        mountHistoryRoutes(app, () => host)
//   Hosted (server-hosted.js): mountHistoryRoutes(app, hostFor)   // per request
//
// Read-only; storage is host.store, so it's identical locally and hosted.

const PER_GROUP = 40;

const trunc = (s, n = 120) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

async function listValues(host, collection, withKey = false) {
  try {
    const items = await host.store.list(collection);
    return items.map((i) => (withKey ? { ...i.value, _id: i.key } : i.value)).filter(Boolean);
  } catch {
    return [];
  }
}

export function mountHistoryRoutes(app, getHost) {
  const wrap = (fn) => async (req, res) => {
    let host;
    try {
      host = getHost(req);
      res.json(await fn(req, host));
    } catch (err) {
      console.error('history route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'history error' });
    }
  };

  // GET /api/history → { ok, groups: [ { type, label, items:[{ id, when, title, badge, detail }] } ] }
  app.get('/api/history', wrap(async (_req, host) => {
    // Claims keyed by timestamp → the store key IS the id used for judgments.
    const claims = (await listValues(host, 'claims', true))
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, PER_GROUP)
      .map((c) => ({
        id: c._id, when: c.timestamp,
        title: c.report?.claim_restated || c.claim_text || (c.had_image ? '(image only)' : '(untitled)'),
        badge: c.report?.tier || null,
        feedback: c.feedback || null,
        detail: c,
      }));

    const origins = (await listValues(host, 'origins'))
      .sort((a, b) => (b.tracked_at || '').localeCompare(a.tracked_at || ''))
      .slice(0, PER_GROUP)
      .map((o) => ({
        id: o.id, when: o.tracked_at,
        title: o.account?.displayHint || o.account?.handle || o.account?.url || o.url || 'origin',
        badge: o.risk_counts?.significant ? `${o.risk_counts.significant} significant` : (o.kind || null),
        feedback: o.feedback || null,
        detail: o,
      }));

    const posts = (await listValues(host, 'posts'))
      .sort((a, b) => (b.analyzed_at || '').localeCompare(a.analyzed_at || ''))
      .slice(0, PER_GROUP)
      .map((p) => ({
        id: p.id, when: p.analyzed_at,
        title: p.risk_profile?.post_restated || trunc(p.post_text) || '(post)',
        badge: p.risk_profile?.confidence || null,
        feedback: p.feedback || null,
        detail: p,
      }));

    const comparisons = (await listValues(host, 'comparisons'))
      .sort((a, b) => (b.compared_at || '').localeCompare(a.compared_at || ''))
      .slice(0, PER_GROUP)
      .map((c) => ({
        id: c.id, when: c.compared_at,
        title: c.comparison?.summary || `comparison of ${c.post_ids?.length || 0} posts`,
        badge: c.comparison?.verdict || null,
        feedback: c.feedback || null,
        detail: c,
      }));

    return {
      ok: true,
      groups: [
        { type: 'verify', label: 'Claim checks', items: claims },
        { type: 'origin', label: 'Origin tracks', items: origins },
        { type: 'listen_analyze', label: 'Post analyses', items: posts },
        { type: 'listen_compare', label: 'Comparisons', items: comparisons },
      ],
    };
  }));
}
