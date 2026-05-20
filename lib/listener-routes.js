// Listener routes — mounted on the express app *after* the runtime has
// wired up the standard /api/* routes. Lives under /api/listener/* so
// the surfaces don't collide.
//
// Wired in index.js with:  mountListenerRoutes(app, host);

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadPages,
  addPage,
  removePage,
  findPageByUrl,
} from './pages.js';
import {
  loadPosts,
  addPost,
  getPostsByIds,
  recentPosts,
} from './posts.js';
import {
  analyzeOrigin,
  comparePosts,
  generateBrief,
} from './listener.js';

const BRIEFS_FILE = './data/processed/capitalfm-listener-briefs.json';

export function mountListenerRoutes(app, host) {
  // Make host reachable from the wrap() helper for structured error logging.
  app.locals.host = host;

  // ─── Watchlist ────────────────────────────────────────────────

  app.get('/api/listener/pages', wrap(async () => {
    const pages = await loadPages();
    return { ok: true, pages };
  }));

  app.post('/api/listener/pages', wrap(async (req) => {
    const result = await addPage(req.body || {});
    if (result.ok) {
      await host.log.run({
        op: 'listener_page_add',
        name: result.page.name,
        admin_country: result.page.admin_country,
      });
    }
    return result;
  }));

  app.delete('/api/listener/pages/:id', wrap(async (req) => {
    const result = await removePage(req.params.id);
    if (result.ok) {
      await host.log.run({ op: 'listener_page_remove', id: req.params.id });
    }
    return result;
  }));

  // ─── Analyse a single post ────────────────────────────────────

  app.post('/api/listener/analyze', wrap(async (req) => {
    const { postText, postUrl, pageUrl, journalistNotes } = req.body || {};
    if (!postText) {
      return { ok: false, error: 'no_input', message: 'Provide the post text.' };
    }

    // Try to match the post's page to a watchlist entry.
    const page = await findPageByUrl(pageUrl);

    await host.log.run({
      op: 'listener_analyze_start',
      page_url: pageUrl || null,
      page_matched: !!page,
    });

    const result = await analyzeOrigin(host, {
      postText,
      postUrl,
      page,
      journalistNotes,
    });

    await host.log.run({
      op: 'listener_analyze_done',
      ok: result.ok,
      confidence: result.profile?.confidence,
    });

    if (result.ok) {
      const stored = await addPost({
        page_url: pageUrl,
        post_url: postUrl,
        post_text: postText,
        page_id: page?.id || null,
        risk_profile: result.profile,
        flagged_concern: journalistNotes || null,
      });
      result.stored_id = stored.id;
    }

    return result;
  }));

  // ─── List analysed posts (the Library tab) ────────────────────

  app.get('/api/listener/posts', wrap(async (req) => {
    const limit = Number(req.query?.limit) || 50;
    const since = req.query?.since || null;
    const posts = await recentPosts({ since, limit });
    return { ok: true, posts };
  }));

  // ─── Compare 2+ posts ─────────────────────────────────────────

  app.post('/api/listener/compare', wrap(async (req) => {
    const { postIds } = req.body || {};
    if (!Array.isArray(postIds) || postIds.length < 2) {
      return { ok: false, error: 'need_at_least_two', message: 'Pick at least two posts to compare.' };
    }
    const posts = await getPostsByIds(postIds);
    if (posts.length < 2) {
      return { ok: false, error: 'posts_not_found', message: 'One or more posts could not be found.' };
    }

    await host.log.run({ op: 'listener_compare_start', count: posts.length });
    const result = await comparePosts(host, posts);
    await host.log.run({
      op: 'listener_compare_done',
      ok: result.ok,
      verdict: result.comparison?.verdict,
    });
    return result;
  }));

  // ─── Weekly editorial brief ───────────────────────────────────

  app.post('/api/listener/brief', wrap(async (req) => {
    const { days = 7 } = req.body || {};
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const [posts, pages] = await Promise.all([
      recentPosts({ since: periodStart.toISOString(), limit: 200 }),
      loadPages(),
    ]);

    await host.log.run({
      op: 'listener_brief_start',
      days,
      posts_count: posts.length,
    });

    const result = await generateBrief(host, {
      posts,
      pages,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
    });

    if (result.ok) {
      const briefs = await readBriefsLog();
      briefs.push(result);
      await writeBriefsLog(briefs);
    }

    await host.log.run({
      op: 'listener_brief_done',
      ok: result.ok,
    });

    return result;
  }));

  app.get('/api/listener/briefs', wrap(async () => {
    const briefs = await readBriefsLog();
    return { ok: true, briefs: briefs.slice(-20).reverse() };
  }));
}

// ─── helpers ─────────────────────────────────────────────────────

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      console.error('listener route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'listener error' });
      // Log to the structured error feed so the cohort dashboard sees it.
      try {
        if (req.app?.locals?.host?.log?.error) {
          await req.app.locals.host.log.error({
            op: req.path,
            error: err,
            context: { method: req.method },
          });
        }
      } catch { /* swallow logging errors */ }
    }
  };
}

async function readBriefsLog() {
  try {
    const text = await fs.readFile(BRIEFS_FILE, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function writeBriefsLog(briefs) {
  await fs.mkdir(path.dirname(BRIEFS_FILE), { recursive: true });
  await fs.writeFile(BRIEFS_FILE, JSON.stringify(briefs, null, 2), 'utf8');
}
