// Watchlist — Facebook pages you are monitoring for the election.
//
// Storage is host.store collection "pages" (one entry per page, keyed by id),
// so the SAME code runs locally (JSON files) and hosted (per-newsroom Postgres).
// Senior staff paste in Page Transparency data they pull from Facebook manually
// (we don't crawl Facebook). The transparency snapshot is the origin-side
// evidence we feed Claude when analysing posts from that page.

import crypto from 'node:crypto';

export async function loadPages(host) {
  const items = await host.store.list('pages');
  return items.map((i) => i.value).filter(Boolean);
}

export async function addPage(host, input) {
  const record = {
    id: crypto.randomUUID(),
    name: (input.name || '').trim(),
    url: (input.url || '').trim(),
    admin_country: (input.admin_country || '').trim() || null,
    created_date: (input.created_date || '').trim() || null,
    name_history: parseList(input.name_history),
    ad_library_active: input.ad_library_active === true || input.ad_library_active === 'true',
    notes: (input.notes || '').trim() || null,
    added_at: new Date().toISOString(),
  };
  if (!record.name || !record.url) {
    return { ok: false, error: 'missing_fields', message: 'Name and URL are both required.' };
  }
  await host.store.put('pages', record.id, record);
  return { ok: true, page: record };
}

export async function removePage(host, id) {
  const existing = await host.store.get('pages', id);
  if (!existing) return { ok: false, error: 'not_found' };
  await host.store.delete('pages', id);
  return { ok: true };
}

export async function findPageByUrl(host, url) {
  if (!url) return null;
  const normalised = url.trim().toLowerCase();
  const pages = await loadPages(host);
  return pages.find((p) => (p.url || '').toLowerCase() === normalised) || null;
}

export function formatPageForPrompt(page) {
  if (!page) {
    return '(No watchlist entry for this page. Senior staff have not yet added Page Transparency data for it.)';
  }
  const lines = [
    `Page name: ${page.name}`,
    `Page URL: ${page.url}`,
    `Admin country (Facebook transparency): ${page.admin_country || 'unknown'}`,
    `Page creation date: ${page.created_date || 'unknown'}`,
    `Ad Library active: ${page.ad_library_active ? 'yes' : 'no'}`,
  ];
  if (page.name_history && page.name_history.length) {
    lines.push(`Name history: ${page.name_history.join(' → ')}`);
  }
  if (page.notes) lines.push(`Newsroom notes: ${page.notes}`);
  return lines.join('\n');
}

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value).split(/\n|,/).map((s) => s.trim()).filter(Boolean);
}
