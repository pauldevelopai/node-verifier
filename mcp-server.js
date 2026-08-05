#!/usr/bin/env node
// Election Watch — MCP boot (local, stdio). Phase-1 spike of the Grounded MCP
// blueprint: hand-written here first; once proven, this generalises into
// createMcpServer in @developai/grounded-node-runtime and this file shrinks to
// a manifest + one call (see grounded2026/docs/MCP_BLUEPRINT.md).
//
// Projects the SAME handlers the web app runs — (host, args) → result — as MCP
// tools over stdio, against the SAME local data (lite host, slug
// capitalfm-verifier), so a journalist's Claude Desktop works on the corpus and
// history their Election Watch install already has. Data and AI key stay on the
// laptop; nothing new is pooled.
//
// Claude Desktop config (claude_desktop_config.json):
//   { "mcpServers": { "election-watch": {
//       "command": "node",
//       "args": ["/absolute/path/to/node-verifier/mcp-server.js"] } } }

import 'dotenv/config';

// stdio transport: stdout IS the JSON-RPC channel. The runtime's lite host and
// this Node both log with console.log — send ALL of that to stderr, before the
// host exists, or the protocol stream gets corrupted.
console.log = (...args) => console.error(...args);

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createLiteHost } from '@developai/grounded-node-runtime';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ensureCorpusReady } from './lib/corpus.js';
import { mcpTools } from './lib/mcp-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

// SAME slug as index.js, so this boot reads/writes the same local JSON data
// (corpus, claims, origins) as the web app. Don't "tidy" it — see CLAUDE.md.
const SLUG = 'capitalfm-verifier';

async function main() {
  // host.store paths are relative → run from the Node's own directory, wherever
  // Claude Desktop spawned us from.
  process.chdir(__dirname);

  const host = createLiteHost({
    appSlug: SLUG,
    nodeVersion: pkg.version,
    newsroom: process.env.NEWSROOM,
  });
  await ensureCorpusReady(host);

  const server = new Server(
    { name: 'grounded-verifier', title: 'Election Watch (Grounded)', version: pkg.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools.map(({ name, title, description, inputSchema, annotations }) => ({
      name, title, description, inputSchema, annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = mcpTools.find((t) => t.name === req.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }] };
    }
    try {
      // The exact contract the REST wrap invokes: (host, args) → result object.
      const result = await tool.handler(host, req.params.arguments || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      await host.log?.error?.({ op: `mcp:${tool.name}`, error: err }).catch(() => {});
      return { isError: true, content: [{ type: 'text', text: `${tool.name} failed: ${err.message || err}` }] };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error(`[mcp] grounded-verifier v${pkg.version} up (stdio) — tools: ${mcpTools.map((t) => t.name).join(', ')}`);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
