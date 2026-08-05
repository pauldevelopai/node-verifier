# node-verifier — "Election Watch" (the host.store reference Node)

A Node on **Grounded** (newsroom-owned AI by Develop AI). AI-assisted
misinformation defence tuned for the August 2026 Zambian elections. Two workflows
in one app:

- **Verify mode** — paste a suspect claim (text and/or screenshot); the AI returns a
  structured verification report against a corpus of past examples.
- **Listen mode** (senior staff) — paste a Facebook post + its Page Transparency
  data; the AI returns an *origin* analysis (where the content came from, not what
  it says), plus a coordination check and a weekly brief.

Copy this Node's shape when a new Node mostly **saves and lists records** (rather
than doing relational queries) — it's the simplest path to multi-tenant hosting.

## Branding vs identifiers — IMPORTANT
Display name is **"Election Watch"** everywhere a human reads it. The canonical
GitHub repo is `pauldevelopai/node-verifier` (the old `node-capitalfm-verifier`
repo is dead). Don't "tidy" the identifiers below — renaming orphans existing data.

Storage prefix is derived from the **slug**, and the two entrypoints use DIFFERENT
slugs, so the table/file names differ — this is intentional, leave it:
- **LOCAL** (`index.js`) slug `capitalfm-verifier` → JSON files `node_capitalfm_verifier_*`
  (e.g. `data/processed/node_capitalfm_verifier_activity.json`).
- **HOSTED** (`server-hosted.js`) slug `verifier` → Postgres tables **`node_verifier_store`**
  and **`node_verifier_activity`** (per-newsroom, scoped by `newsroom_id`).

## Three entrypoints, same handlers
- **`index.js`** (LOCAL): `createLiteHost` + `createServer({ slug, host, handlers, displayName:"Election Watch" })`, then `mountListenerRoutes(app, () => host)` for the Listen-mode routes. Storage = JSON files, the user's own AI key.
- **`server-hosted.js`** (ONLINE): sets `process.env.GROUNDED_HOSTED="1"`, then `await createHostedServer({ slug:"verifier", productName:"Election Watch", handlers, mountRoutes:(app,{hostFor})=>mountListenerRoutes(app,hostFor), staticDir })`. Runs on the box as pm2 `verifier-hosted` on :3004, reached at `/nodes/verifier/app/`.
- **`mcp-server.js`** (MCP, local stdio): projects `postBrief` + `inspectUrl` as the MCP tools `verify_claim` / `trace_origin` for e.g. Claude Desktop — same slug (`capitalfm-verifier`), same local data as `index.js`. Phase-1 spike of `grounded2026/docs/MCP_BLUEPRINT.md`; curated manifest in `lib/mcp-tools.js`, wiring + gotchas in `MCP.md`.

Handlers (`lib/handlers.js`, `lib/verifier.js`, `lib/pages.js`, `lib/posts.js`,
`lib/listener-routes.js`, `lib/corpus.js`) target ONLY the host interface — no
`fs`/`pg`/`express`. `getSetupStatus` returns `configured:true` when
`GROUNDED_HOSTED` (the AI key is server-managed online); `postSetup` refuses online.

## The host.store pattern (why this Node is the reference)
All state is `host.store` collections — same API local (JSON files) and hosted
(`node_verifier_store` Postgres table, per-newsroom):
- `claims` — verification results (keyed by timestamp, so `list` is chronological)
- `corpus` — training examples (uploaded as text/files via `postIngest`)
- `pages` — Listen-mode watchlist; `posts` — analysed posts; `briefs` — weekly briefs

No `ensureSchema` needed — the runtime auto-creates the store table. Custom
Listen-mode routes (`/api/listener/*`) are attached through the **`mountRoutes`**
hook; the wrapper closes over `getHost`/`hostFor` so each route uses a per-request,
newsroom-scoped host.

## Verify-mode origin tracking (Facebook)
Verify mode can take a **Facebook post URL** and track WHERE it came from + whether
the account looks dangerous/fake. Route: **`POST /api/inspect`** (`lib/inspect-routes.js`,
mounted in BOTH entrypoints alongside the listener routes).
- **`lib/facebook.js`** — native JS, no deps: `parseFacebookUrl` (identifies the
  account/page + post id from the URL shape), `fetchFacebookMeta` (best-effort OG;
  degrades to `{blocked}` behind FB's login wall), `accountRiskSignals` (transparent
  heuristic panel — descriptive flags + weights, NO numeric score, same "editor
  decides" philosophy as listener.js). This is the **local download's only path**.
- **`lib/enrich.js`** — **HOSTED-ONLY**, behind server-managed env tokens, all
  logged-off public data (NO Facebook login/cookies — on the right side of
  *Meta v. Bright Data*). Auto-fills the journalist's "Add context" form:
  **Apify** (primary), **Bright Data** (fallback) for page profile + transparency;
  **Meta Ad Library API** for political-ad lookup. Tokens: `APIFY_TOKEN`,
  `BRIGHTDATA_TOKEN`+`BRIGHTDATA_FB_DATASET_ID`, `META_ADLIB_TOKEN` (see `.env.example`).
  With no token set, `enrichmentStatus()` is all-false and it's pure native fallback.
  NB: scraper output field names drift — `enrich.js` extraction is deliberately
  tolerant (`FIELD_KEYS` candidate lists); verify mappings once against a live token.
The origin packet (parse + risk + merged context + enrichment + ads) rides along
with the verify call (`postBrief`), is woven into the prompt (`formatOriginForPrompt`
in verifier.js), and is stored on the claim as `account_origin`.

## public/
The dashboard. Uses RELATIVE paths (`<script src="app.js">`, `fetch("api/…")`) so it
works at `/` (local) and under `/nodes/verifier/app/` (hosted). All 17 fetches are
relative — if you add one, keep it relative or it 404s against the tracker.

## Deps & deploy
`@developai/grounded-node-runtime` (pinned `#v0.14.0` — host.store + mountRoutes need
≥v0.9.0) + dotenv. Box: `cd /home/ubuntu/node-verifier && git pull && rm -rf node_modules/@developai && npm install && pm2 restart verifier-hosted`. `.env` (never
committed) needs `JWT_SECRET` matching the tracker + a real `sk-ant-` `ANTHROPIC_API_KEY`
+ `DATABASE_URL`. NB: the README, launchers, and update.mjs are local-install only —
changing them needs no box redeploy of the hosted service.

See the tracker repo's `CLAUDE.md` for the system map; `pauldevelopai/nodes` →
`HANDOVER.md` + `ADD_A_NODE.md` to add a new Node.
