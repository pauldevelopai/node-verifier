// Listener posts — the longitudinal record of every post Capital FM has
// run through origin analysis. This is the Library tab in the UI and the
// evidence base for the weekly brief.
//
// Storage is host.store collection "posts" (one entry per post, keyed by id),
// so the same code runs locally (JSON files) and hosted (per-newsroom Postgres).
// Append-only in practice — we never edit past records.

import crypto from 'node:crypto';

export async function loadPosts(host) {
  const items = await host.store.list('posts');
  return items.map((i) => i.value).filter(Boolean);
}

export async function addPost(host, input) {
  const record = {
    id: crypto.randomUUID(),
    page_url: (input.page_url || '').trim() || null,
    post_url: (input.post_url || '').trim() || null,
    post_text: (input.post_text || '').trim(),
    page_id: input.page_id || null,
    risk_profile: input.risk_profile || null,
    flagged_concern: input.flagged_concern || null,
    analyzed_at: new Date().toISOString(),
  };
  await host.store.put('posts', record.id, record);
  return record;
}

export async function getPost(host, id) {
  return (await host.store.get('posts', id)) || null;
}

export async function getPostsByIds(host, ids) {
  if (!ids || !ids.length) return [];
  const set = new Set(ids);
  const posts = await loadPosts(host);
  return posts.filter((p) => set.has(p.id));
}

export async function recentPosts(host, { since, limit = 50 } = {}) {
  const posts = await loadPosts(host);
  const cutoff = since ? new Date(since).toISOString() : null;
  return posts
    .filter((p) => (cutoff ? p.analyzed_at >= cutoff : true))
    .sort((a, b) => (a.analyzed_at || '').localeCompare(b.analyzed_at || ''))
    .slice(-limit)
    .reverse();
}
