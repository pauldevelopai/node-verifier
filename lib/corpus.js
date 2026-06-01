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

// ─── Relevance retrieval (TF-IDF) ────────────────────────────────────
// "RAG-by-inclusion" doesn't scale: every verify call would inject the WHOLE
// corpus, so token cost grows with every example a newsroom adds. Instead, rank
// examples by similarity to the claim and pass only the most relevant K. Pure,
// dependency-free, deterministic.

const STOP = new Set(['the','a','an','and','or','but','of','to','in','on','for','with','at','by','from','is','are','was','were','be','been','as','that','this','it','its','they','their','has','have','had','not','no','will','would','can','about','into','over','after','before','than','then','said','says']);

function tokenize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

/**
 * Pick the `k` corpus examples most relevant to `query` (the claim text), by
 * TF-IDF cosine similarity. Returns all examples (capped at k) when there's no
 * query to rank against, or when the corpus already fits.
 */
export function selectRelevant(examples, query, k = 8) {
  if (!examples || examples.length <= k) return examples || [];
  const q = tokenize(query);
  if (!q.length) return examples.slice(0, k);   // image-only claim → can't rank

  const docs = examples.map(ex => tokenize(ex.content));
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const idf = t => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;

  const vec = toks => {
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Map();
    for (const [t, f] of tf) v.set(t, f * idf(t));
    return v;
  };
  const qv = vec(q);
  const dot = (a, b) => { let s = 0; for (const [t, w] of a) if (b.has(t)) s += w * b.get(t); return s; };
  const norm = v => Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0)) || 1;
  const qn = norm(qv);

  return examples
    .map((ex, i) => { const dv = vec(docs[i]); return { ex, score: dot(qv, dv) / (qn * norm(dv)) }; })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter(x => x.score > 0)              // drop examples with zero overlap
    .map(x => x.ex);
}
