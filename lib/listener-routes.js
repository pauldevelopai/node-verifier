// Listener routes — the /api/listener/* surface (origin analysis of suspicious
// Facebook content). Mounted after the standard routes.
//
//   Local  (index.js):        mountListenerRoutes(app, () => host)
//   Hosted (server-hosted.js): mountListenerRoutes(app, hostFor)   // per request
//
// `getHost(req)` returns the host to use for THIS request — a fixed lite host
// locally, or a per-request, newsroom-scoped Postgres host online. All storage
// goes through host.store (collections: pages, posts, briefs), so it's
// multi-tenant online and file-based on a laptop with the same code.

import {
  loadPages, addPage, removePage, findPageByUrl,
} from './pages.js';
import {
  addPost, getPostsByIds, recentPosts,
} from './posts.js';
import {
  analyzeOrigin, comparePosts, generateBrief,
} from './listener.js';

export function mountListenerRoutes(app, getHost) {
  const wrap = (fn) => async (req, res) => {
    let host;
    try {
      host = getHost(req);
      res.json(await fn(req, host));
    } catch (err) {
      console.error('listener route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'listener error' });
      try { await host?.log?.error?.({ op: req.path, error: err, context: { method: req.method } }); }
      catch { /* swallow */ }
    }
  };

  // ─── Watchlist ────────────────────────────────────────────────
  app.get('/api/listener/pages', wrap(async (_req, host) => ({ ok: true, pages: await loadPages(host) })));

  app.post('/api/listener/pages', wrap(async (req, host) => {
    const result = await addPage(host, req.body || {});
    if (result.ok) await host.log.run({ op: 'listener_page_add', name: result.page.name, admin_country: result.page.admin_country });
    return result;
  }));

  app.delete('/api/listener/pages/:id', wrap(async (req, host) => {
    const result = await removePage(host, req.params.id);
    if (result.ok) await host.log.run({ op: 'listener_page_remove', id: req.params.id });
    return result;
  }));

  // ─── Analyse a single post ────────────────────────────────────
  app.post('/api/listener/analyze', wrap(async (req, host) => {
    const { postText, postUrl, pageUrl, journalistNotes } = req.body || {};
    if (!postText) return { ok: false, error: 'no_input', message: 'Provide the post text.' };

    const page = await findPageByUrl(host, pageUrl);
    await host.log.run({ op: 'listener_analyze_start', page_url: pageUrl || null, page_matched: !!page });

    const result = await analyzeOrigin(host, { postText, postUrl, page, journalistNotes });
    await host.log.run({ op: 'listener_analyze_done', ok: result.ok, confidence: result.profile?.confidence });

    if (result.ok) {
      const stored = await addPost(host, {
        page_url: pageUrl, post_url: postUrl, post_text: postText,
        page_id: page?.id || null, risk_profile: result.profile, flagged_concern: journalistNotes || null,
      });
      result.stored_id = stored.id;
    }
    return result;
  }));

  // ─── List analysed posts (Library tab) ────────────────────────
  app.get('/api/listener/posts', wrap(async (req, host) => {
    const limit = Number(req.query?.limit) || 50;
    const since = req.query?.since || null;
    return { ok: true, posts: await recentPosts(host, { since, limit }) };
  }));

  // ─── Compare 2+ posts ─────────────────────────────────────────
  app.post('/api/listener/compare', wrap(async (req, host) => {
    const { postIds } = req.body || {};
    if (!Array.isArray(postIds) || postIds.length < 2) return { ok: false, error: 'need_at_least_two', message: 'Pick at least two posts to compare.' };
    const posts = await getPostsByIds(host, postIds);
    if (posts.length < 2) return { ok: false, error: 'posts_not_found', message: 'One or more posts could not be found.' };
    await host.log.run({ op: 'listener_compare_start', count: posts.length });
    const result = await comparePosts(host, posts);
    await host.log.run({ op: 'listener_compare_done', ok: result.ok, verdict: result.comparison?.verdict });
    return result;
  }));

  // ─── Weekly editorial brief ───────────────────────────────────
  app.post('/api/listener/brief', wrap(async (req, host) => {
    const { days = 7 } = req.body || {};
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const [posts, pages] = await Promise.all([
      recentPosts(host, { since: periodStart.toISOString(), limit: 200 }),
      loadPages(host),
    ]);
    await host.log.run({ op: 'listener_brief_start', days, posts_count: posts.length });
    const result = await generateBrief(host, {
      posts, pages,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
    });
    if (result.ok) {
      const key = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
      await host.store.put('briefs', key, result);
    }
    await host.log.run({ op: 'listener_brief_done', ok: result.ok });
    return result;
  }));

  app.get('/api/listener/briefs', wrap(async (_req, host) => {
    const items = await host.store.list('briefs');
    const briefs = items.map((i) => i.value).slice(-20).reverse();
    return { ok: true, briefs };
  }));
}
