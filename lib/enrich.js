// Facebook enrichment — HOSTED-ONLY, behind server-managed env tokens.
//
// The local download (index.js) never runs this: no token, no network cost. It
// only kicks in on the box when a token is configured, turning the journalist's
// manual "Add context" form into PRE-FILLED, confirm-able data. The native-JS
// path in facebook.js stays the fallback everywhere.
//
// Three providers, all cookieless / logged-off (no Facebook account, on the right
// side of Meta v. Bright Data). All via plain fetch — no SDK, no new dependency:
//   • Apify       (primary)  — page profile + creation date + transparency/ads
//   • Bright Data (fallback) — structured page JSON, if Apify yields nothing
//   • Meta Ad Library API    — official, free: political ads + funder for a page
//
// IMPORTANT (field mapping): the scraper output schemas drift, so extraction is
// deliberately tolerant (firstOf over many candidate keys) and we keep a `raw`
// sample for the route to log on the first live run. Verify the mappings once
// against a real token and tighten `FIELD_KEYS` if needed. The Ad Library shape
// is Meta's documented Graph API and is stable.

import { cleanCanonicalUrl } from './facebook.js';

const env = (k) => (process.env[k] || '').trim();

export function enrichmentStatus() {
  return {
    hosted: !!process.env.GROUNDED_HOSTED,
    apify: !!env('APIFY_TOKEN'),
    brightdata: !!(env('BRIGHTDATA_TOKEN') && env('BRIGHTDATA_FB_DATASET_ID')),
    adlibrary: !!env('META_ADLIB_TOKEN'),
  };
}

// Candidate keys per logical field. Verified against a live apify/facebook-pages-scraper
// run (2026-06-01); first key in each list is the one that actor actually returns.
const FIELD_KEYS = {
  display_name: ['title', 'name', 'pageName', 'page_name'],
  page_id: ['pageId', 'facebookId', 'page_id', 'id', 'pageID'],
  created_date: ['creation_date', 'creationDate', 'pageCreatedDate', 'page_created_date', 'created', 'createdDate', 'foundedDate'],
  followers: ['followers', 'followersCount', 'followers_count', 'likes', 'likesCount'],
  following: ['followings', 'following', 'followingCount', 'following_count'],
  category: ['category', 'categories', 'pageCategory'],
  confirmed_owner: ['CONFIRMED_OWNER_LABEL', 'confirmed_owner'],
  // The pages scraper does NOT return these — they stay manual (journalist reads
  // them from Facebook's Page Transparency panel). Keys kept for other actors.
  verified: ['isVerified', 'verified', 'is_verified', 'verification'],
  admin_country: ['adminCountry', 'admin_country', 'managedFrom', 'managed_from', 'pageManagedFrom', 'adminCountries', 'admin_countries'],
  name_history: ['nameHistory', 'name_history', 'previousNames', 'pastNames', 'nameChanges'],
};

function firstOf(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

export function normalizeFbRecord(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const out = {};
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    const v = firstOf(rec, keys);
    if (v != null) out[field] = v;
  }
  // Transparency data sometimes nests under an object (other actors).
  const tx = rec.pageTransparency || rec.page_transparency || rec.transparency || rec.about_profile_transparency;
  if (tx && typeof tx === 'object') {
    out.created_date = out.created_date || firstOf(tx, FIELD_KEYS.created_date);
    out.admin_country = out.admin_country || firstOf(tx, FIELD_KEYS.admin_country);
    out.name_history = out.name_history || firstOf(tx, FIELD_KEYS.name_history);
  }
  // Ad Library id is nested under pageAdLibrary on the pages scraper.
  out.ad_library_id = out.ad_library_id || rec.pageAdLibrary?.id || rec.adLibraryId || null;
  // Derive "currently running ads" from the human-readable ad_status string.
  const adStatus = rec.ad_status || rec.adStatus || '';
  if (/running ads/i.test(adStatus)) out.ad_library_active = true;

  // Normalise shapes.
  if (Array.isArray(out.admin_country)) out.admin_country = out.admin_country.join(', ');
  if (out.admin_country && typeof out.admin_country === 'object') {
    out.admin_country = Object.entries(out.admin_country).map(([c, n]) => `${c}${n ? ` (${n})` : ''}`).join(', ');
  }
  if (out.name_history && !Array.isArray(out.name_history)) out.name_history = [String(out.name_history)];
  if (Array.isArray(out.category)) out.category = out.category.join(', ');
  out.followers = numOrNull(out.followers);
  out.following = numOrNull(out.following);
  // Only assert verification if the actor actually returned a verification field —
  // the pages scraper doesn't, and "unknown" must not become "not verified".
  if (firstOf(rec, FIELD_KEYS.verified) != null) {
    out.verified = rec.isVerified === true || /verified|yes|true/i.test(String(firstOf(rec, FIELD_KEYS.verified)));
  } else {
    delete out.verified;
  }
  // confirmed_owner often comes as a sentence ("X is responsible for this Page").
  if (out.confirmed_owner) out.confirmed_owner = String(out.confirmed_owner).replace(/\s+is responsible for this page\.?$/i, '').trim();
  out.created_date = out.created_date ? String(out.created_date) : null;
  // Drop empties (keep ad_library_active:true; drop false/null).
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '' || out[k] === false) delete out[k];
  return Object.keys(out).length ? out : null;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, '').replace(/k$/i, 'e3').replace(/m$/i, 'e6'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function fetchJsonSafe(url, opts = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: res.ok, status: res.status, body, text };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Apify (primary) ─────────────────────────────────────────────────
// run-sync-get-dataset-items: one synchronous call returns the dataset array.
async function apifyAccount(parsed) {
  const token = env('APIFY_TOKEN');
  if (!token) return null;
  const actor = env('APIFY_PAGES_ACTOR') || 'apify~facebook-pages-scraper';
  const accountUrl = parsed?.account?.url || parsed?.normalizedUrl;
  if (!accountUrl) return null;

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetchJsonSafe(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url: accountUrl }], resultsLimit: 1 }),
  });
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) return null;
  const fields = normalizeFbRecord(r.body[0]);
  return fields ? { source: 'apify', fields, raw: r.body[0] } : null;
}

// Recent posts (Apify) — for the posting-cadence heuristic. Verified against a
// live apify~facebook-posts-scraper run: fields time (ISO), timestamp (unix),
// likes, comments, shares, text, url. Returns [] on any failure.
export async function fetchRecentPosts(parsed) {
  const token = env('APIFY_TOKEN');
  if (!token || !parsed?.isFacebook) return [];
  const pageUrl = parsed?.account?.url || parsed?.normalizedUrl;
  if (!pageUrl) return [];
  const actor = env('APIFY_POSTS_ACTOR') || 'apify~facebook-posts-scraper';
  const limit = Number(env('APIFY_POSTS_LIMIT')) || 15;

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetchJsonSafe(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url: pageUrl }], resultsLimit: limit }),
  }, 90000);
  if (!r.ok || !Array.isArray(r.body)) return [];
  return r.body.map((p) => ({
    time: p.time || null,
    timestamp: p.timestamp || null,
    likes: p.likes ?? null,
    comments: p.comments ?? null,
    shares: p.shares ?? null,
    text: typeof p.text === 'string' ? p.text.slice(0, 200) : null,
    url: p.url || p.topLevelUrl || null,
  }));
}

// ─── Bright Data (fallback) ──────────────────────────────────────────
// Trigger a collection on a dataset, then poll the snapshot until ready.
async function brightDataAccount(parsed) {
  const token = env('BRIGHTDATA_TOKEN');
  const dataset = env('BRIGHTDATA_FB_DATASET_ID');
  if (!token || !dataset) return null;
  const accountUrl = parsed?.account?.url || parsed?.normalizedUrl;
  if (!accountUrl) return null;

  const trigger = await fetchJsonSafe(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${encodeURIComponent(dataset)}&include_errors=true`,
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify([{ url: accountUrl }]) },
    20000,
  );
  const snapshotId = trigger.body?.snapshot_id || trigger.body?.snapshotId;
  if (!trigger.ok || !snapshotId) return null;

  // Poll (bounded) for the snapshot to finish.
  for (let i = 0; i < 8; i++) {
    await sleep(3000);
    const snap = await fetchJsonSafe(
      `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
      { headers: { authorization: `Bearer ${token}` } }, 20000,
    );
    if (snap.ok && Array.isArray(snap.body) && snap.body.length) {
      const fields = normalizeFbRecord(snap.body[0]);
      return fields ? { source: 'brightdata', fields, raw: snap.body[0] } : null;
    }
    // 202/running → keep polling; anything else → give up.
    if (snap.status && snap.status !== 202 && snap.status !== 200) break;
  }
  return null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Resolve the AUTHOR of a single post/photo permalink (Apify posts scraper).
// For URLs that don't name the account (/photo/?fbid=…, permalink.php, story.php),
// the scraper still reads the owning profile/page from the post itself. Verified
// live: returns creation_story.actors[].name + owner + created_time + caption.
async function apifyPostAuthor(url) {
  const token = env('APIFY_TOKEN');
  if (!token || !url) return null;
  const actor = env('APIFY_POSTS_ACTOR') || 'apify~facebook-posts-scraper';
  const ep = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetchJsonSafe(ep, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url }], resultsLimit: 1 }),
  }, 90000);
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) return null;
  const rec = r.body[0];
  const cs = rec.creation_story || {};
  const actor0 = (Array.isArray(cs.actors) && cs.actors[0]) || rec.owner || {};
  const name = actor0.name || null;
  const typename = String(actor0.__typename || rec.owner?.__typename || '').toLowerCase();
  const fields = {};
  if (name) fields.display_name = name;
  fields.account_type = typename.includes('page') ? 'page' : 'profile';
  if (actor0.id) fields.author_id = actor0.id;
  if (rec.created_time) { try { fields.post_time = new Date(rec.created_time * 1000).toISOString(); } catch { /* skip */ } }
  const caption = rec.accessibility_caption || cs.message?.text || (typeof rec.text === 'string' ? rec.text : null);
  if (caption) fields.post_text = String(caption).slice(0, 500);
  if (cs.post_promotion_info || cs.sponsored_data) fields.sponsored = true;
  if (!name && !fields.post_text) return null;   // nothing useful resolved
  return { source: 'apify', fields, raw: rec };
}

// Pure extraction of the resolved origin from one Apify posts-scraper record.
// Kept separate (and exported) so the field mapping is unit-testable without a
// live token. Tolerant by design — the scraper's schema drifts, so we read the
// author from creation_story.actors[], owner, or the flat page/user fields, and
// the canonical post URL from whichever url-ish key is present. Returns null if
// nothing identifying came back. Verify once against a live run and tighten.
export function extractResolvedPost(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const cs = rec.creation_story || {};
  const actor0 = (Array.isArray(cs.actors) && cs.actors[0]) || rec.owner || rec.author || {};
  const name = actor0.name || rec.pageName || rec.userName || null;
  const typename = String(actor0.__typename || rec.owner?.__typename || rec.authorType || '').toLowerCase();
  const type = typename.includes('page') ? 'page'
    : (typename.includes('user') || typename.includes('profile')) ? 'profile'
    : 'profile';
  const id = actor0.id || rec.pageId || rec.userId || null;
  const authorUrl = actor0.url || actor0.profile_url || rec.pageUrl || rec.profileUrl
    || (id && /^\d+$/.test(String(id)) ? `https://www.facebook.com/profile.php?id=${id}` : null);
  const canonicalUrl = cleanCanonicalUrl(rec.url || rec.topLevelUrl || rec.postUrl || rec.link || '') || null;
  let postTime = null;
  if (typeof rec.time === 'string') postTime = rec.time;
  else if (rec.timestamp) { try { postTime = new Date(Number(rec.timestamp) * 1000).toISOString(); } catch { /* skip */ } }
  else if (rec.created_time) { try { postTime = new Date(Number(rec.created_time) * 1000).toISOString(); } catch { /* skip */ } }
  const caption = rec.accessibility_caption || cs.message?.text || (typeof rec.text === 'string' ? rec.text : null);
  const text = caption ? String(caption).slice(0, 500) : null;
  if (!name && !canonicalUrl && !text) return null;
  return {
    author: { name: name || null, type, id: id ? String(id) : null, url: authorUrl || null },
    canonicalUrl,
    postTime,
    text,
    sponsored: !!(cs.post_promotion_info || cs.sponsored_data),
  };
}

// Resolve an OBSCURED share/reel/watch link to its canonical post + author via
// Apify's post scraper. Facebook now login-walls the free mbasic redirect, so
// this is the paid fallback that recovers WHERE a post came from. Returns
// { author, canonicalUrl, postTime, text, source, raw } or null. Never throws.
export async function apifyResolvePost(url) {
  const token = env('APIFY_TOKEN');
  if (!token || !url) return null;
  const actor = env('APIFY_POSTS_ACTOR') || 'apify~facebook-posts-scraper';
  const ep = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetchJsonSafe(ep, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url }], resultsLimit: 1 }),
  }, 90000);
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) return null;
  const resolved = extractResolvedPost(r.body[0]);
  return resolved ? { ...resolved, source: 'apify', raw: r.body[0] } : null;
}

// ─── Facebook Groups (Apify) ─────────────────────────────────────────
// A group link resolves to the GROUP as the container; the pages scraper only
// returns its name. A groups actor reads the public group card — member count,
// when it was created, public/private, category. Pure extractor kept separate
// so the mapping is unit-testable; tolerant because the actor schema drifts.
const GROUP_KEYS = {
  display_name: ['name', 'title', 'groupName', 'group_name'],
  member_count: ['memberCount', 'membersCount', 'members', 'member_count', 'membersCountText'],
  created_date: ['creationDate', 'createdDate', 'creation_date', 'createdAt', 'foundedDate', 'creationTime'],
  privacy_raw: ['privacy', 'groupType', 'visibility', 'type'],
  group_id: ['id', 'groupId', 'group_id', 'pageId', 'fbid'],
  name_history: ['nameHistory', 'name_history', 'previousNames', 'pastNames'],
  category: ['category', 'categories', 'groupCategory'],
};

function normalizePrivacy(rec) {
  const raw = firstOf(rec, GROUP_KEYS.privacy_raw);
  if (raw != null) {
    const s = String(raw).toLowerCase();
    if (/priv|closed|secret/.test(s)) return 'Private';
    if (/pub|open/.test(s)) return 'Public';
  }
  if (typeof rec.isPublic === 'boolean') return rec.isPublic ? 'Public' : 'Private';
  return null;
}

export function extractGroupFields(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const out = { account_type: 'group' };
  const name = firstOf(rec, GROUP_KEYS.display_name);
  if (name) out.display_name = String(name);
  const members = numOrNull(firstOf(rec, GROUP_KEYS.member_count));
  if (members != null) out.member_count = members;
  const created = firstOf(rec, GROUP_KEYS.created_date);
  if (created) out.created_date = String(created);
  const privacy = normalizePrivacy(rec);
  if (privacy) out.group_privacy = privacy;
  const gid = firstOf(rec, GROUP_KEYS.group_id);
  if (gid) out.group_id = String(gid);
  let hist = firstOf(rec, GROUP_KEYS.name_history);
  if (hist && !Array.isArray(hist)) hist = [String(hist)];
  if (Array.isArray(hist) && hist.length) out.name_history = hist.map(String);
  const cat = firstOf(rec, GROUP_KEYS.category);
  if (cat) out.category = Array.isArray(cat) ? cat.join(', ') : String(cat);
  // Only meaningful if we learned SOMETHING beyond the type tag.
  return Object.keys(out).length > 1 ? out : null;
}

async function apifyGroup(parsed) {
  const token = env('APIFY_TOKEN');
  if (!token || !parsed?.isFacebook) return null;
  const groupUrl = parsed?.account?.url || parsed?.normalizedUrl;
  if (!groupUrl) return null;
  const actor = env('APIFY_GROUPS_ACTOR') || 'apify~facebook-groups-scraper';
  const ep = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const r = await fetchJsonSafe(ep, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url: groupUrl }], resultsLimit: 1 }),
  }, 90000);
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) return null;
  const fields = extractGroupFields(r.body[0]);
  return fields ? { source: 'apify', fields, raw: r.body[0] } : null;
}

/**
 * Best-effort account enrichment.
 *  - Group URL                              → group card via the groups actor.
 *  - Page/profile URL (handle in the link) → full profile via Apify, Bright Data fallback.
 *  - Post/photo permalink (no handle)       → resolve the author from the post itself.
 * Returns { source, fields, raw } or null. Never throws.
 */
export async function enrichFacebookAccount(parsed) {
  if (!parsed?.isFacebook) return null;
  // Groups carry their own transparency (members, created date, public/private)
  // that the pages scraper doesn't return — resolve them with the groups actor.
  if (parsed.account?.type === 'group' || parsed.kind === 'group_post') {
    try {
      const g = await apifyGroup(parsed);
      if (g?.fields) return g;
    } catch { /* fall through to the generic path */ }
  }
  if (parsed.account?.url) {
    try {
      const a = await apifyAccount(parsed);
      if (a?.fields) return a;
    } catch { /* fall through to bright data */ }
    try {
      const b = await brightDataAccount(parsed);
      if (b?.fields) return b;
    } catch { /* none available */ }
    return null;
  }
  // No page handle in the URL — resolve the author from the post.
  if (parsed.isPermalink) {
    try {
      const r = await apifyPostAuthor(parsed.inputUrl || parsed.normalizedUrl);
      if (r?.fields) return r;
    } catch { /* none available */ }
  }
  return null;
}

// ─── Meta Ad Library API (official, free) ────────────────────────────
// Political/social-issue ads for a page, scoped to a country (default Zambia).
export async function lookupPoliticalAds(parsed, context = {}) {
  const token = env('META_ADLIB_TOKEN');
  if (!token || !parsed?.isFacebook) return null;
  const country = env('ADLIB_COUNTRY') || 'ZM';
  const version = env('META_GRAPH_VERSION') || 'v21.0';

  // Prefer a numeric page id (from enrichment); otherwise search by name/handle.
  const pageId = context.page_id || parsed?.account?.numericId;
  const term = parsed?.account?.displayHint || parsed?.account?.handle;
  const params = new URLSearchParams({
    access_token: token,
    ad_reached_countries: JSON.stringify([country]),
    ad_type: 'POLITICAL_AND_ISSUE_ADS',
    ad_active_status: 'ALL',
    fields: 'page_id,page_name,funding_entity,ad_delivery_start_time,ad_delivery_stop_time,impressions,spend,currency,ad_snapshot_url,publisher_platforms',
    limit: '15',
  });
  if (pageId && /^\d+$/.test(String(pageId))) params.set('search_page_ids', JSON.stringify([String(pageId)]));
  else if (term) params.set('search_terms', term);
  else return null;

  const r = await fetchJsonSafe(`https://graph.facebook.com/${version}/ads_archive?${params}`, {}, 20000);
  if (!r.ok || !r.body) {
    return { available: true, ok: false, error: r.body?.error?.message || `http_${r.status}`, count: 0, sample: [] };
  }
  const data = Array.isArray(r.body.data) ? r.body.data : [];
  const funders = [...new Set(data.map((d) => d.funding_entity).filter(Boolean))];
  return {
    available: true,
    ok: true,
    country,
    count: data.length,
    has_more: !!r.body.paging?.next,
    funders,
    sample: data.slice(0, 5).map((d) => ({
      funder: d.funding_entity || null,
      spend: rangeStr(d.spend),
      impressions: rangeStr(d.impressions),
      started: d.ad_delivery_start_time || null,
      platforms: Array.isArray(d.publisher_platforms) ? d.publisher_platforms.join(', ') : null,
      snapshot_url: d.ad_snapshot_url || null,
    })),
  };
}

function rangeStr(r) {
  if (!r) return null;
  if (typeof r === 'string') return r;
  if (r.lower_bound || r.upper_bound) return `${r.lower_bound || '0'}–${r.upper_bound || '?'}`;
  return null;
}

// ─── Context merge ───────────────────────────────────────────────────
// Enrichment provides the base; the journalist's explicit entries override it.
export function mergeContext(base = {}, over = {}) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    const meaningful = v === true || (typeof v === 'string' && v.trim() !== '') || (Array.isArray(v) && v.length);
    if (meaningful) merged[k] = v;
  }
  return merged;
}
