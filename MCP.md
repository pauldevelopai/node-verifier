# Election Watch as an MCP server (phase-1 spike)

This Node now has a **third boot mode** beside local (`index.js`) and hosted
(`server-hosted.js`): a local **MCP server over stdio** that projects two of the
Node's real handlers as MCP tools. This Node was the phase-1 spike of
`grounded2026/docs/MCP_BLUEPRINT.md`; the adapter now lives in the runtime
(`createMcpServer`, ≥ v0.15.0) and this Node keeps only the curated manifest
(`lib/mcp-tools.js`) plus a ~40-line boot file (`mcp-server.js`). Any Node can
now do the same — copy those two files and curate the manifest from that Node's
own handlers.

## What's exposed

Curated in `lib/mcp-tools.js` — deliberately NOT every route:

| Tool | Handler | What it does |
|------|---------|--------------|
| `verify_claim` | `postBrief` (`lib/handlers.js`) | Verify a claim (text and/or screenshot) against the newsroom's corpus; returns the tiered report + citations. Needs an AI key in `.env`. |
| `trace_origin` | `inspectUrl` (`lib/inspect-routes.js`) | Track where a Facebook post came from + the heuristic account-risk panel. No AI key needed. |

Both write one history record (claims / origins) to the Node's **local** data —
same slug (`capitalfm-verifier`), same JSON files as the web app, so Claude
Desktop and the dashboard see one shared history. Data and AI key never leave
the laptop; this is the federation case from the blueprint.

## Run it

```bash
npm run start:mcp
```

…but normally you don't run it by hand — the MCP client spawns it. For Claude
Desktop, add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "election-watch": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/node-verifier/mcp-server.js"]
    }
  }
}
```

Restart Claude Desktop, then ask it e.g. *"Use trace_origin on this Facebook
link"* or *"Verify this claim: …"*.

## Gotchas

- **stdout is the protocol channel.** The runtime's lite host logs with
  `console.log`; call the runtime's `redirectConsoleForStdio()` before the
  host is created (mcp-server.js does). Never print to stdout from anything
  this boot loads.
- `verify_claim` needs the same `.env` setup as the web app (`ANTHROPIC_API_KEY`
  etc.); without one it returns the handler's error rather than crashing.
- Tested end-to-end in `tests/mcp.test.js` (spawns the server, speaks JSON-RPC).
