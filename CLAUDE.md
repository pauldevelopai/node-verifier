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

## What this Node contributes to the corpus (`lib/corpus-writeback.js`)
Everything here also persists to `host.store` — but that is a Node-local silo, so
each result is written **twice**: once for the app, once for the platform. Two
collections, because they answer different questions:

- **`misinformation_record`** — the claim or post itself: what circulated, in
  which jurisdiction, the AI's tier/confidence as `outcome`, the reasoning chain,
  the web citations, the coordination flags. Born `ai_drafted`. This is the
  Zambian election misinformation archive, and it outlives the app.
- **`newsroom_ai`** — the practice signal, written when a journalist rules:
  `outcome` is `agreed` or `overruled`. Adoption data with an outcome attached —
  how often the AI was *right*, not how often it was used.

The verification contract needs no parallel workflow: a journalist approving a
result in the judgments loop **is** the named human verification, so an approve
flips that record to `human_verified` with their email. `verifiedBy` comes from
the tracker session (`req.user.email`), never the request body. Running locally
there is no signed-in person, so the record honestly stays `ai_drafted`.

Every call is **guarded and best-effort**: it returns null on a runtime without
`host.corpus` (logging once, loudly — a Node that silently writes nothing looks
identical to one that works) and never throws into a journalist's result. The
corpus dedups on `source_url`, so `linkableId` refuses to link a claim to a
record that belongs to a *different* claim from the same URL — otherwise
approving one would stamp `human_verified` on the other.

- **Origin tracking** (`/api/inspect`) writes a record about the SOURCE, not the
  claim: the account, whether the URL hides its author behind a share token, the
  Page Transparency merge (admin country, creation date, name history, ad
  activity), the risk flags with their weights, and any political ads found.
  Keyed on the account URL, so re-tracking one page updates one record. Over an
  election that becomes a map of the accounts pushing misinformation — the thing
  a claim archive alone cannot give you, because one page turns up behind a
  hundred claims.
- **Use itself** is recorded, whether or not anyone rates anything: one
  `newsroom_ai` record per newsroom per function per month (`signal: 'usage'`,
  `outcome: 'in_use'`). Without it a newsroom that runs 400 checks and never
  presses approve would contribute nothing to the adoption record — which is
  exactly the newsroom we most want counted. Counts stay in the Node's store and
  activity log; the corpus carries the shape of adoption across newsrooms and
  time.

The newsroom's **name and country come from `host.meta.org`** (runtime v0.18.0),
never from an env var — hosted, one process serves every newsroom, so a single
`NEWSROOM_JURISDICTION` would stamp a Kenyan newsroom's records `ZM`. With no
country set the field is empty rather than guessed. `NEWSROOM_COUNTRY` /
`NEWSROOM_JURISDICTION` remain the answer for a local install, where the install
really is one newsroom.

Needs runtime **≥ v0.18.0** (`host.corpus`, the `misinformation_record`
collection, and `host.meta.org`). On anything older the write-backs no-op and say
so in the log.

## Deps & deploy
`@developai/grounded-node-runtime` (pin is in `package.json`; the current tag
lives in `grounded2026/CLAUDE.md` — host.store + mountRoutes need ≥v0.9.0,
corpus write-back needs ≥v0.18.0) + dotenv. Box: `cd /home/ubuntu/node-verifier && git pull && rm -rf node_modules/@developai && npm install "github:pauldevelopai/grounded-node-runtime#<tag>" && pm2 restart verifier-hosted --update-env`. **Naming the tag on the install line is not optional.** `package-lock.json` records the RESOLVED COMMIT of the old tag, and a plain `npm install` reuses it — so the runtime silently stays on the old version even after `rm -rf node_modules/@developai` and even with the new tag in `package.json`. Seen 2026-08-31: pinned v0.18.0, installed v0.15.0, no error. Check what actually landed: `node -p "require('./node_modules/@developai/grounded-node-runtime/package.json').version"`. `.env` (never
committed) needs `JWT_SECRET` matching the tracker + a real `sk-ant-` `ANTHROPIC_API_KEY`
+ `DATABASE_URL`. NB: the README, launchers, and update.mjs are local-install only —
changing them needs no box redeploy of the hosted service.

See the tracker repo's `CLAUDE.md` for the system map; `pauldevelopai/nodes` →
`HANDOVER.md` + `ADD_A_NODE.md` to add a new Node.
