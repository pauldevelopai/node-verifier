// Watchlist — Facebook pages Capital FM is monitoring for the election.
//
// Senior staff add pages they want to watch and paste in Page Transparency
// data they've manually pulled from Facebook (admin country, creation date,
// name history, ad-library activity). The transparency snapshot is the
// origin-side evidence we feed Claude when analysing posts from that page.
//
// We deliberately don't crawl Facebook. CrowdTangle is dead; Meta Content
// Library is gated behind research access; the Graph API needs app review.
// The realistic v1 is paste-driven, so we build to that constraint.
//
// Storage: ./data/processed/capitalfm-listener-pages.json
// Shape: array of page records.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PAGES_FILE = './data/processed/capitalfm-listener-pages.json';

export async function loadPages() {
  try {
    const text = await fs.readFile(PAGES_FILE, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function savePages(pages) {
  await fs.mkdir(path.dirname(PAGES_FILE), { recursive: true });
  await fs.writeFile(PAGES_FILE, JSON.stringify(pages, null, 2), 'utf8');
}

export async function addPage(input) {
  const pages = await loadPages();
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
  pages.push(record);
  await savePages(pages);
  return { ok: true, page: record };
}

export async function removePage(id) {
  const pages = await loadPages();
  const next = pages.filter((p) => p.id !== id);
  if (next.length === pages.length) return { ok: false, error: 'not_found' };
  await savePages(next);
  return { ok: true };
}

export async function findPageByUrl(url) {
  if (!url) return null;
  const pages = await loadPages();
  const normalised = url.trim().toLowerCase();
  return pages.find((p) => p.url.toLowerCase() === normalised) || null;
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
  return String(value)
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}
