// Corpus management for Capital FM Claim Check.
//
// The "corpus" is a folder of plain-text files. Each file is one past
// example of misinformation Capital FM (or anyone in the cohort) has
// flagged before — fake polling station notice, fabricated lawmaker
// post, doctored ballot photo. The newsroom adds new files as they
// collect cases.
//
// On every claim-verification request the corpus is loaded fresh and
// included in the AI prompt. Simple RAG-by-inclusion. When the corpus
// exceeds ~50 examples we'll move to embeddings + retrieval; until
// then this is the simplest thing that works.

import fs from 'node:fs/promises';
import path from 'node:path';

const CORPUS_DIR = './data/raw/training-examples';
const CORPUS_README = path.join(CORPUS_DIR, 'README.md');

const STARTER_README = `# Training examples

Drop one .txt file per past example of misinformation Capital FM has
flagged. Plain text. No special format required — the AI will read
each file as-is.

What makes a good example file:

  • A short title at the top, e.g. "Fake polling station closure 2021"
  • A few sentences describing what the claim was
  • Where it appeared (Facebook, WhatsApp, radio, etc.)
  • How it was debunked or what gave it away
  • Optional: any phrases or patterns that recurred ("BREAKING:",
    misspelled official names, a particular phone number)

The more examples you collect, the better the AI gets at recognising
new cases. Aim for at least 10 examples before the August window.
Twenty is better. Fifty is excellent — at that point we'll move to
a smarter retrieval system.

Filename convention: YYYY-MM-DD-short-slug.txt
  e.g. 2021-08-12-fake-polling-station.txt
       2024-03-04-lawmaker-resignation-rumour.txt
`;

export async function ensureCorpusReady(host) {
  try {
    await fs.mkdir(CORPUS_DIR, { recursive: true });
    try {
      await fs.access(CORPUS_README);
    } catch {
      await fs.writeFile(CORPUS_README, STARTER_README, 'utf8');
      host.log.run({
        op: 'corpus_init',
        note: 'Seeded training-examples folder with starter README',
      });
    }
  } catch (err) {
    console.error('Could not initialise corpus folder:', err.message);
  }
}

export async function loadCorpus() {
  try {
    const entries = await fs.readdir(CORPUS_DIR, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.txt'))
      .map((e) => e.name)
      .sort();

    const examples = [];
    for (const file of files) {
      const content = await fs.readFile(path.join(CORPUS_DIR, file), 'utf8');
      examples.push({ filename: file, content: content.trim() });
    }
    return examples;
  } catch {
    return [];
  }
}

export function formatCorpusForPrompt(examples) {
  if (examples.length === 0) {
    return '(No past examples loaded yet. Use general reasoning about misinformation patterns.)';
  }
  return examples
    .map((ex, i) => `─── Example ${i + 1}: ${ex.filename} ───\n${ex.content}`)
    .join('\n\n');
}
