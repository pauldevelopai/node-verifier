// Judge routes — the /api/judge surface. A journalist approves or disapproves a
// result the Node produced; that verdict feeds the learning DB (lib/judgments.js)
// so the Node improves over time. Distinct from the runtime's
// /api/grounded/feedback (free-text feedback to Develop AI) — this rates results.
//
//   Local  (index.js):        mountJudgeRoutes(app, () => host)
//   Hosted (server-hosted.js): mountJudgeRoutes(app, hostFor)   // per request

import { recordJudgment, loadJudgments } from './judgments.js';

export function mountJudgeRoutes(app, getHost) {
  const wrap = (fn) => async (req, res) => {
    let host;
    try {
      host = getHost(req);
      res.json(await fn(req, host));
    } catch (err) {
      console.error('judge route error:', err);
      res.status(500).json({ ok: false, error: err.message || 'judge error' });
      try { await host?.log?.error?.({ op: req.path, error: err, context: { method: req.method } }); }
      catch { /* swallow */ }
    }
  };

  // POST /api/judge  { result_type, result_id, verdict, correction? }
  //
  // `verifiedBy` is the signed-in person, taken from the tracker session the
  // runtime already verified (req.user, set by the hosted server's /api auth
  // middleware) — never from the request body, which the browser controls.
  // Running locally there is no session and so no named person: the shared
  // record stays ai_drafted rather than claiming a verification we can't attribute.
  app.post('/api/judge', wrap(async (req, host) => {
    const { result_type, result_id, verdict, correction } = req.body || {};
    return recordJudgment(host, {
      result_type, result_id, verdict, correction,
      verifiedBy: req.user?.email || null,
    });
  }));

  // GET /api/judge  → the learning DB (most recent first) for a "what the Node
  // has learned" view.
  app.get('/api/judge', wrap(async (_req, host) => {
    const judgments = await loadJudgments(host);
    judgments.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const approved = judgments.filter((j) => j.verdict === 'approve').length;
    return {
      ok: true,
      total: judgments.length,
      approved,
      disapproved: judgments.length - approved,
      judgments: judgments.slice(0, 100),
    };
  }));
}
