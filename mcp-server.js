#!/usr/bin/env node
// Election Watch — MCP boot (local, stdio). Third entrypoint beside index.js
// (local web) and server-hosted.js (online): projects the SAME handlers as MCP
// tools for e.g. Claude Desktop, against the SAME local data as index.js. Data
// and AI key stay on the laptop.
//
// The adapter lives in the runtime (createMcpServer, runtime ≥ v0.15.0 — this
// Node was the phase-1 spike that proved it; see grounded2026/docs/MCP_BLUEPRINT.md).
// This file is just: redirect stdout-logging, build the lite host, boot.
//
// Claude Desktop config (claude_desktop_config.json):
//   { "mcpServers": { "election-watch": {
//       "command": "node",
//       "args": ["/absolute/path/to/node-verifier/mcp-server.js"] } } }

import 'dotenv/config';
import { createLiteHost, createMcpServer, redirectConsoleForStdio } from '@developai/grounded-node-runtime';

// stdio transport: stdout IS the JSON-RPC channel — silence console.log before
// anything (the lite host included) can write to it.
redirectConsoleForStdio();

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as handlers from './lib/handlers.js';
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

  await createMcpServer({
    slug: 'verifier',                 // server name grounded-verifier (display identity)
    productName: 'Election Watch',
    nodeVersion: pkg.version,
    host,
    handlers,
    tools: mcpTools,
  });
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
