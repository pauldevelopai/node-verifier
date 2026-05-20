# NODE.md — Capital FM Election Watch

This card identifies this repo as a Node in the GROUNDED ecosystem.
The full system architecture lives elsewhere; this file just locates
this Node within it.

## Identity

| | |
|---|---|
| **Slug** | `capitalfm-verifier` *(retained from v0.1; scope has since broadened)* |
| **Display name** | Capital FM Election Watch |
| **Current version** | 0.2.0 |
| **Status** | build |
| **Born** | 2026-05-20 (verifier); 2026-05-20 (listener added) |
| **Pilot newsroom** | Capital FM (Zambia) |
| **Repo** | `pauldevelopai/node-capitalfm-verifier` (public) |
| **Election window** | August 2026 Zambian elections (May–July prototype) |

## What this Node does

Two editorial workflows in one app, sharing infrastructure (auth,
data, activity log) but separated by mode in the UI.

### Verify mode — claim verification

A journalist pastes a suspect claim (text and/or screenshot) plus an
optional source URL. The AI compares it against a corpus of past
Zambian-election misinformation examples maintained by the newsroom
and returns a structured verification report — confidence tier,
matching past examples, reasoning chain, specific further checks the
journalist should run, and a suggested draft response.

The corpus is the heart of Verify mode. The newsroom adds real cases
as they encounter them; the AI gets better at recognising patterns in
Zambian electoral context.

### Listen mode — origin analysis

Senior staff watch a list of Facebook pages and paste suspect posts
plus the Facebook Page Transparency data they've manually pulled. The
AI returns an Origin Risk Profile focused on **where the content came
from, not what it says** — transparency mismatches, linguistic tells,
talking-point lifts from foreign sources, page-history anomalies. The
output is descriptive (flags + reasoning + further checks), never a
numeric score.

A Compare workflow checks two or more posts for coordination signals
(content overlap, timing, shared phrasing). A Brief workflow generates
a weekly editorial summary from the analysed posts.

Listen mode is deliberately senior-staff-controlled and paste-driven.
v1 does not crawl Facebook — CrowdTangle is dead, Meta Content
Library is gated behind research access, the Graph API needs app
review. v1 is built to the paste-driven constraint, not apologising
for it.

## How this Node fits into GROUNDED

This is a **standalone Node** — a small self-contained app that runs
on a newsroom's laptop. It depends on the shared
`grounded-node-runtime` package. When it meets its graduation
criteria (≥3 newsrooms, ≥50 ops across modes, ≥60% accept rate) it
folds into the GROUNDED monorepo at `lib/nodes/capitalfm-verifier/`
— at which point the Zambian-specific framing softens into more
general claim-verification and origin-analysis capabilities for any
newsroom in the cohort.

## Trajectory

- Phase 1 (May–July 2026): Build on one Capital FM laptop. Iterate.
  Capital FM collects real Zambian electoral misinformation examples
  into the Verify corpus and adds pages to the Listen watchlist.
- Phase 2 (August 2026): Live use during the election window. Daily
  verification and origin-analysis runs. Activity log and Library
  accumulate.
- Phase 3 (post-August 2026): Generalise. Verify becomes a Zambian-
  context-aware claim-verification tool; Listen becomes a general
  origin-analysis tool. Other newsrooms in the ZimZam cohort consider
  adopting either or both.
- Phase 4 (graduation): Folds into GROUNDED monorepo when criteria
  met.

## API surface

Auto-mounted by the runtime (Verify mode + setup):
```
GET  /api/setup
POST /api/setup
GET  /api/sources    (corpus contents)
GET  /api/report     (recent verifications)
GET  /api/quality    (tier counts)
GET  /api/activity
POST /api/brief      (verify a claim)
POST /api/ingest     (add corpus example)
```

Listener routes (mounted in index.js):
```
GET    /api/listener/pages      (watchlist)
POST   /api/listener/pages      (add page)
DELETE /api/listener/pages/:id  (remove page)
POST   /api/listener/analyze    (origin analysis on a post)
GET    /api/listener/posts      (library)
POST   /api/listener/compare    (coordination check)
POST   /api/listener/brief      (generate weekly brief)
GET    /api/listener/briefs     (past briefs)
```

## Links

- README for Capital FM: [`README.md`](./README.md)
- System reference (Drive folder 02): "2026-05-20 GROUNDED Nodes —
  System Reference v1.0"
- System reference (in repo): `NODES.md` in
  `pauldevelopai/grounded-node-runtime`
- Registry: `pauldevelopai/groundedai` repo,
  `docs/nodes/registry.yaml`
