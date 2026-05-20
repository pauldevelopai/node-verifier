# NODE.md — Capital FM Claim Check

This card identifies this repo as a Node in the GROUNDED ecosystem.
The full system architecture lives elsewhere; this file just locates
this Node within it.

## Identity

| | |
|---|---|
| **Slug** | `capitalfm-verifier` |
| **Display name** | Capital FM Claim Check |
| **Current version** | 0.1.0 |
| **Status** | build |
| **Born** | 2026-05-20 |
| **Pilot newsroom** | Capital FM (Zambia) |
| **Repo** | `pauldevelopai/node-capitalfm-verifier` (public) |
| **Election window** | August 2026 Zambian elections (May–July prototype) |

## What this Node does

AI-assisted misinformation defence and editorial verification for an
investigative newsroom. The journalist pastes a suspect claim (text
and/or screenshot) plus an optional source URL; the AI compares it
against a corpus of past Zambian-election misinformation examples
maintained by the newsroom and returns a structured verification
report — confidence tier, matching past examples, reasoning chain,
specific further checks the journalist should run, and a suggested
draft response.

The corpus is the heart of the Node. The newsroom adds real cases
as they encounter them; the AI gets better at recognising patterns
in Zambian electoral context.

## How this Node fits into GROUNDED

This is a **standalone Node** — a small self-contained app that runs
on a newsroom's laptop. It depends on the shared
`grounded-node-runtime` package. When it meets its graduation
criteria (≥3 newsrooms, ≥50 verifications, ≥60% accept rate) it
folds into the GROUNDED monorepo at `lib/nodes/capitalfm-verifier/`
— at which point the Zambian-specific framing softens into a more
general claim-verification capability for any newsroom in the cohort.

## Trajectory

- Phase 1 (May–July 2026): Build on one Capital FM laptop. Iterate.
  Capital FM collects real Zambian electoral misinformation examples
  into the corpus.
- Phase 2 (August 2026): Live use during the election window.
  Daily verification runs. Activity log accumulates.
- Phase 3 (post-August 2026): Generalise. The Node becomes a Zambian-
  context-aware claim-verification tool, not an election-specific
  tool. Other newsrooms in the ZimZam cohort consider adopting it.
- Phase 4 (graduation): Folds into GROUNDED monorepo when criteria
  met.

## Links

- README for Capital FM: [`README.md`](./README.md)
- System reference (Drive folder 02): "2026-05-20 GROUNDED Nodes —
  System Reference v1.0"
- System reference (in repo): `NODES.md` in
  `pauldevelopai/grounded-node-runtime`
- Registry: `pauldevelopai/groundedai` repo,
  `docs/nodes/registry.yaml`
