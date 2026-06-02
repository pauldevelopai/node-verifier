/**
 * server-hosted.js — the ONLINE (multi-tenant) entry for the newsroom Election
 * Watch. The runtime's createHostedServer provides auth (tracker cookie), a
 * per-request newsroom-scoped host (host.store backed by Postgres), the standard
 * route map, and the GROUNDED chrome. We add the /api/listener/* routes via the
 * mountRoutes hook (per-request host). The LOCAL entry (index.js) is the mirror.
 *
 * Env (box .env, never committed): JWT_SECRET (matches the tracker's),
 * ANTHROPIC_API_KEY (shared), DATABASE_URL or PG*. Optional: PORT, MODEL.
 */

import dotenv from "dotenv";
dotenv.config({ override: true });
// Tell the handlers the AI key is server-managed (skip the local .env setup flow).
process.env.GROUNDED_HOSTED = "1";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHostedServer } from "@developai/grounded-node-runtime";
import * as handlers from "./lib/handlers.js";
import { mountListenerRoutes } from "./lib/listener-routes.js";
import { mountInspectRoutes } from "./lib/inspect-routes.js";
import { mountJudgeRoutes } from "./lib/judge-routes.js";
import { mountHistoryRoutes } from "./lib/history-routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

await createHostedServer({
  slug: "verifier",
  productName: "Election Watch",
  handlers,
  // Custom Listen-mode routes; hostFor(req) gives a per-request, newsroom-scoped host.
  mountRoutes: (app, { hostFor }) => {
    // The runtime serves the chrome-injected index.html with no cache header, so
    // browsers heuristically cache the app shell and miss UI updates until a hard
    // refresh. mountRoutes runs BEFORE the static/catch-all handlers, so a no-cache
    // header set here makes the shell (and assets) always revalidate. /api is
    // untouched (those routes already matched and responded earlier).
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) res.set('Cache-Control', 'no-cache');
      next();
    });
    mountListenerRoutes(app, hostFor);
    mountInspectRoutes(app, hostFor);
    mountJudgeRoutes(app, hostFor);
    mountHistoryRoutes(app, hostFor);
  },
  nodeVersion: pkg.version,
  staticDir: join(__dirname, "public"),
});
