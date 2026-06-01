// tests/facebook.test.js — share-link resolution + URL parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFacebookUrl, cleanCanonicalUrl, interpretLocation, resolveFacebookShare, OBSCURED_KINDS,
} from '../lib/facebook.js';

// Real Location header captured from mbasic.facebook.com resolving a /share/p/ token.
const REAL_LOC =
  'https://mbasic.facebook.com/groups/698593531630485/permalink/1539466397543190/?rdid=C40GibOmyFgfcB5m&share_url=https%3A%2F%2Fmbasic.facebook.com%2Fshare%2Fp%2F17npzFD5Me%2F&wtsid=rdr_0Se0&refsrc=deprecated&_rdr';

test('cleanCanonicalUrl normalises host and strips tracking params', () => {
  const out = cleanCanonicalUrl(REAL_LOC);
  assert.equal(out, 'https://www.facebook.com/groups/698593531630485/permalink/1539466397543190/');
});

test('interpretLocation reads a canonical post out of a share redirect', () => {
  const step = interpretLocation(REAL_LOC, 'https://mbasic.facebook.com/share/p/17npzFD5Me/');
  assert.equal(step.type, 'canonical');
  assert.equal(step.url, 'https://www.facebook.com/groups/698593531630485/permalink/1539466397543190/');
});

test('interpretLocation keeps following share hops and recovers ?next on the login wall', () => {
  assert.equal(interpretLocation('https://mbasic.facebook.com/share/p/abc/', 'https://x').type, 'follow');
  const login = 'https://mbasic.facebook.com/login.php?next=' +
    encodeURIComponent('https://mbasic.facebook.com/groups/1/permalink/2/');
  const step = interpretLocation(login, 'https://x');
  assert.equal(step.type, 'canonical');
  assert.equal(step.url, 'https://www.facebook.com/groups/1/permalink/2/');
  // A login wall with no usable next → just 'login'.
  assert.equal(interpretLocation('https://mbasic.facebook.com/login.php', 'https://x').type, 'login');
});

test('the resolved canonical re-parses to the real group post', () => {
  const p = parseFacebookUrl('https://www.facebook.com/groups/698593531630485/permalink/1539466397543190/');
  assert.equal(p.kind, 'group_post');
  assert.equal(p.account.numericId, '698593531630485');
  assert.equal(p.postId, '1539466397543190');
  assert.ok(!OBSCURED_KINDS.has(p.kind));
});

test('resolveFacebookShare follows a mocked redirect chain to the canonical', async () => {
  // Fake fetch: share → group permalink (one hop), like mbasic really does.
  const fetchImpl = async () => ({ headers: { get: (k) => (k === 'location' ? REAL_LOC : null) } });
  const r = await resolveFacebookShare('https://www.facebook.com/share/p/17npzFD5Me/', { fetchImpl });
  assert.equal(r.resolved, true);
  assert.equal(r.url, 'https://www.facebook.com/groups/698593531630485/permalink/1539466397543190/');
  assert.equal(r.via, 'mbasic_redirect');
});

test('resolveFacebookShare degrades gracefully when there is no redirect', async () => {
  const fetchImpl = async () => ({ headers: { get: () => null } });
  const r = await resolveFacebookShare('https://www.facebook.com/share/p/x/', { fetchImpl });
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'no_redirect');
});
