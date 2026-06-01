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

function normalizeFbRecord(rec) {
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

/**
 * Best-effort account enrichment: Apify first, Bright Data as fallback.
 * Returns { source, fields, raw } or null. Never throws.
 */
export async function enrichFacebookAccount(parsed) {
  if (!parsed?.isFacebook) return null;
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
