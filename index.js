// Capital FM Election Watch — entry point.
//
// Two workflows under one app:
//   1. Verify mode  — claim verification against a corpus of past examples
//      (handlers in lib/handlers.js, auto-mounted by the runtime)
//   2. Listen mode  — origin analysis of suspicious Facebook content
//      (routes in lib/listener-routes.js, mounted after createServer)
//
// The runtime auto-mounts the standard /api/* surface from handlers.js.
// Listener routes live under /api/listener/* and are attached directly
// to the express app the runtime returns.

import 'dotenv/config';
import { createLiteHost, createServer } from '@developai/grounded-node-runtime';
import * as handlers from './lib/handlers.js';
import { ensureCorpusReady } from './lib/corpus.js';
import { mountListenerRoutes } from './lib/listener-routes.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const SLUG = 'capitalfm-verifier';
const DISPLAY_NAME = 'Capital FM Election Watch';

async function main() {
  const host = createLiteHost({
    appSlug: SLUG,
    nodeVersion: pkg.version,
    newsroom: process.env.NEWSROOM || 'Capital FM',
  });

  // Verifier-specific: seed the training-examples folder if empty.
  await ensureCorpusReady(host);

  const app = createServer({
    slug: SLUG,
    host,
    handlers,
    displayName: DISPLAY_NAME,
    nodeVersion: pkg.version,
  });

  // Listener-specific routes — mounted on the returned express app so
  // they sit alongside the runtime's standard routes without colliding.
  mountListenerRoutes(app, host);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
