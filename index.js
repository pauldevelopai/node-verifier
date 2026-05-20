// Capital FM Claim Check — boot
//
// Identical infrastructure pattern to node-makanday-analytics:
//   1. Build the host facade via createLiteHost from the shared runtime
//   2. Hand handlers.js to createServer; it auto-mounts the standard routes
//   3. Listen on PORT (default 3000)
//
// Application logic lives in lib/. Don't put logic in this file.

import { createLiteHost, createServer } from '@developai/grounded-node-runtime';
import * as handlers from './lib/handlers.js';
import { ensureCorpusReady } from './lib/corpus.js';

const SLUG = 'capitalfm-verifier';
const DISPLAY_NAME = 'Capital FM Claim Check';
const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const host = await createLiteHost({
    slug: SLUG,
    displayName: DISPLAY_NAME,
    dataDir: './data',
  });

  // Seed the training-examples folder with a starter README if empty.
  // Capital FM populates this as they collect real cases.
  await ensureCorpusReady(host);

  const server = createServer({ host, handlers });

  server.listen(PORT, () => {
    console.log('');
    console.log(`✓ ${DISPLAY_NAME} is running.`);
    console.log(`✓ Open this in your web browser:  http://localhost:${PORT}`);
    console.log('');
    console.log('  Press Ctrl+C in this window to stop it.');
    console.log('');
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
