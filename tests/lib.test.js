// tests/lib.test.js — pure-logic tests for the verifier's helper modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiJson, imageTooLarge } from '../lib/json.js';
import { selectRelevant } from '../lib/corpus.js';
import { normalizeFbRecord } from '../lib/enrich.js';
import { fetchUrlText } from '../lib/fetch-url.js';

// ─── parseAiJson ─────────────────────────────────────────────────────
test('parseAiJson reads plain, fenced, and prose-wrapped JSON', () => {
  assert.equal(parseAiJson('{"tier":"VERIFIED"}').value.tier, 'VERIFIED');
  assert.equal(parseAiJson('```json\n{"tier":"CONTESTED"}\n```').value.tier, 'CONTESTED');
  assert.equal(parseAiJson('Here is the result:\n{"tier":"LIKELY FALSE"}\nDone.').value.tier, 'LIKELY FALSE');
  // Accepts the { text } shape host.ai.chat returns.
  assert.equal(parseAiJson({ text: '{"ok":1}' }).value.ok, 1);
  // Non-JSON → ok:false with the raw kept.
  const bad = parseAiJson('no json here');
  assert.equal(bad.ok, false);
  assert.ok(bad.raw.includes('no json'));
});

test('imageTooLarge guards oversized base64', () => {
  assert.equal(imageTooLarge('x'.repeat(100)), false);
  assert.equal(imageTooLarge('x'.repeat(5_400_001)), true);
  assert.equal(imageTooLarge(null), false);
});

// ─── corpus selectRelevant ───────────────────────────────────────────
test('selectRelevant ranks the most on-topic examples first', () => {
  const corpus = [
    { filename: 'mine.txt', content: 'Fake notice claims the polling station moved to a mine compound.' },
    { filename: 'health.txt', content: 'Fabricated post about a hospital closing during the election.' },
    { filename: 'ballot.txt', content: 'Doctored photo of a ballot box being stuffed at a polling station.' },
    { filename: 'sport.txt', content: 'Rumour about a football transfer, unrelated to politics.' },
    { filename: 'roads.txt', content: 'Claim about a road project budget in the capital.' },
    { filename: 'water.txt', content: 'Story about a water shortage in a township.' },
  ];
  const picked = selectRelevant(corpus, 'A notice says the polling station has been relocated', 3);
  assert.ok(picked.length <= 3);
  assert.equal(picked[0].filename, 'mine.txt');           // shares "polling station" + "notice"
  assert.ok(!picked.some(p => p.filename === 'sport.txt')); // unrelated example excluded
});

test('selectRelevant returns everything when corpus already fits or no query', () => {
  const small = [{ filename: 'a.txt', content: 'one' }, { filename: 'b.txt', content: 'two' }];
  assert.equal(selectRelevant(small, 'anything', 8).length, 2);
  const big = Array.from({ length: 12 }, (_, i) => ({ filename: `${i}.txt`, content: 'x y z' }));
  assert.equal(selectRelevant(big, '', 8).length, 8);     // image-only claim → first K
});

// ─── enrich normalizeFbRecord (drifting scraper schemas) ─────────────
test('normalizeFbRecord maps varied scraper keys and normalises shapes', () => {
  const out = normalizeFbRecord({
    title: 'Some Page', pageId: '123', followersCount: '12,400',
    creation_date: '2026-04-01', categories: ['News', 'Media'],
    adminCountries: ['Russia', 'Zambia'], ad_status: 'This page is currently running ads',
  });
  assert.equal(out.display_name, 'Some Page');
  assert.equal(out.page_id, '123');
  assert.equal(out.followers, 12400);              // comma-stripped number
  assert.equal(out.category, 'News, Media');       // array joined
  assert.equal(out.admin_country, 'Russia, Zambia');
  assert.equal(out.ad_library_active, true);       // derived from ad_status string
});

test('normalizeFbRecord does not invent a verified=false from missing data', () => {
  const out = normalizeFbRecord({ title: 'Page', pageId: '1' });
  assert.ok(!('verified' in out), 'unknown verification must stay unknown, not false');
});

// ─── fetch-url skips Facebook (no network needed) ────────────────────
test('fetchUrlText returns null for Facebook hosts without fetching', async () => {
  assert.equal(await fetchUrlText('https://www.facebook.com/groups/1/permalink/2/'), null);
  assert.equal(await fetchUrlText('not a url'), null);
});
