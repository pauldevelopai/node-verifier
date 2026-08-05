// MCP tool manifest — the ONLY handlers this Node exposes as MCP tools, with the
// JSON Schema + safety annotations MCP requires. Curated on purpose: setup and
// corpus-ingest stay off the surface; these two are the Node's real capabilities.
//
// Each entry's handler is a plain (host, args) → result function — the exact
// contract the runtime's REST wrap already invokes — so the MCP boot
// (mcp-server.js) adds no logic of its own.
//
// Annotation honesty note: both tools WRITE one record to the newsroom's own
// store (a claims / origins history row) as a side effect of answering, so
// readOnlyHint is false. Neither destroys anything (destructiveHint false), and
// both may reach the open web (openWorldHint true).

import { postBrief } from './handlers.js';
import { inspectUrl } from './inspect-routes.js';

export const mcpTools = [
  {
    name: 'verify_claim',
    title: 'Verify a claim',
    description:
      "Check a factual claim against this newsroom's corpus of verified past examples " +
      '(Election Watch, tuned for the August 2026 Zambian elections). Returns a structured ' +
      'verification report with a tier (VERIFIED / CONTESTED / LIKELY FALSE / INSUFFICIENT ' +
      'EVIDENCE), reasoning and citations, and stores the check in the newsroom’s claims history.',
    inputSchema: {
      type: 'object',
      properties: {
        claimText: { type: 'string', description: 'The claim to verify, as text.' },
        sourceUrl: {
          type: 'string',
          description: 'Optional URL where the claim appeared — fetched (best-effort) and given to the verification as context.',
        },
        imageBase64: {
          type: 'string',
          description: 'Optional screenshot of the claim, base64-encoded (no data: prefix). Provide claimText, an image, or both.',
        },
        imageMimeType: {
          type: 'string',
          description: 'MIME type of imageBase64, e.g. image/png. Required if imageBase64 is set.',
        },
      },
      required: ['claimText'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: postBrief,
  },
  {
    name: 'trace_origin',
    title: 'Trace a post’s origin',
    description:
      'Track WHERE a social-media post came from and whether the account looks dangerous or fake. ' +
      'Facebook links only for now: identifies the account/page from the URL shape, resolves obscured ' +
      'share links, attempts an OpenGraph fetch (honestly reports when Facebook’s login wall blocks it), ' +
      'and returns a transparent heuristic risk panel — descriptive flags, no fake numeric score. ' +
      'Stores the origin result in the newsroom’s history. Non-Facebook URLs return supported: false.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The social-media post URL to trace.' },
        context: {
          type: 'object',
          description:
            'Optional Page Transparency context the journalist already knows (e.g. page_created, ' +
            'admin_countries, name_changes, ad_library_active) — sharpens the risk heuristics.',
          additionalProperties: true,
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: inspectUrl,
  },
];
