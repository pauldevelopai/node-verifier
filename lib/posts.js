// Listener posts — the longitudinal record of every post Capital FM has
// run through origin analysis. This is the Library tab in the UI and the
// evidence base for the weekly brief.
//
// Storage: ./data/processed/capitalfm-listener-posts.json
// One JSON file, append-only in practice (we never edit past records).

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const POSTS_FILE = './data/processed/capitalfm-listener-posts.json';

export async function loadPosts() {
  try {
    const text = await fs.readFile(POSTS_FILE, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function savePosts(posts) {
  await fs.mkdir(path.dirname(POSTS_FILE), { recursive: true });
  await fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2), 'utf8');
}

export async function addPost(input) {
  const posts = await loadPosts();
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
  posts.push(record);
  await savePosts(posts);
  return record;
}

export async function getPost(id) {
  const posts = await loadPosts();
  return posts.find((p) => p.id === id) || null;
}

export async function getPostsByIds(ids) {
  if (!ids || !ids.length) return [];
  const posts = await loadPosts();
  const set = new Set(ids);
  return posts.filter((p) => set.has(p.id));
}

export async function recentPosts({ since, limit = 50 } = {}) {
  const posts = await loadPosts();
  const cutoff = since ? new Date(since).toISOString() : null;
  return posts
    .filter((p) => (cutoff ? p.analyzed_at >= cutoff : true))
    .slice(-limit)
    .reverse();
}
