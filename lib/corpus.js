// Corpus management for Election Watch claim check.
//
// The "corpus" is a set of plain-text examples — each one a past case of
// misinformation you (or the cohort) has flagged: fake polling-station
// notice, fabricated lawmaker post, doctored ballot photo. The newsroom adds new
// ones as they collect cases.
//
// Stored in host.store collection "corpus" (key = filename, value = text), so it
// works identically locally (JSON files) and hosted (per-newsroom Postgres). On
// every verification request the corpus is loaded fresh and included in the AI
// prompt — simple RAG-by-inclusion until it's big enough to need embeddings.

export async function ensureCorpusReady(/* host */) {
  // Nothing to seed — host.store creates collections lazily on first write.
  // (Kept for call-site compatibility with index.js.)
}

export async function loadCorpus(host) {
  try {
    const items = await host.store.list('corpus');
    return items
      .filter((i) => i.key && i.key.toLowerCase().endsWith('.txt'))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((i) => ({ filename: i.key, content: String(i.value || '').trim() }));
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
