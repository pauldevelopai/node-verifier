// Facebook origin inspection — native JS, no scraping deps, no Python.
//
// Three jobs, all deterministic / best-effort, none of them "guessing":
//
//   parseFacebookUrl(url)        → WHERE is this from? Identify the account/page
//                                  behind a Facebook URL and the post id, from the
//                                  URL shape alone. Works offline, always.
//
//   fetchFacebookMeta(url)       → best-effort OpenGraph fetch (title/image/name).
//                                  Facebook usually serves a login/consent wall to
//                                  unauthenticated bots, so this DEGRADES GRACEFULLY
//                                  to { blocked:true } — that's expected, not a bug.
//
//   accountRiskSignals(parsed, context)
//                                → IS this a dangerous/fake account? A transparent
//                                  heuristic panel: descriptive flags + weights, the
//                                  things we could NOT determine, and a one-line
//                                  summary. NO numeric score, NO binary verdict —
//                                  the editor decides (same philosophy as listener.js).
//
// Honest limitation baked in: native JS behind Facebook's login wall cannot read
// follower counts, page age, or admin country from a URL. Those come from the
// journalist's "add context" form (the same Page Transparency fields as pages.js).

const FB_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com',
  'web.facebook.com', 'fb.com', 'www.fb.com', 'business.facebook.com', 'fb.watch',
]);

// Path heads that are Facebook features, never a user/page vanity handle.
const RESERVED = new Set([
  'profile.php', 'permalink.php', 'story.php', 'photo.php', 'photo', 'watch',
  'groups', 'share', 'reel', 'reels', 'events', 'marketplace', 'pages', 'pg',
  'people', 'media', 'video', 'videos', 'hashtag', 'search', 'help', 'settings',
  'bookmarks', 'friends', 'gaming', 'live', 'notes', 'about', 'p',
]);

/**
 * Identify the account behind a Facebook URL and the post, from the URL alone.
 * Returns { isFacebook:false } for anything that isn't a Facebook link.
 */
export function parseFacebookUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); }
  catch { return { isFacebook: false, inputUrl: String(input || '') }; }

  const host = u.hostname.toLowerCase().replace(/^l\.facebook\.com$/, 'facebook.com');
  if (!FB_HOSTS.has(host)) return { isFacebook: false, inputUrl: input };

  const segs = u.pathname.split('/').filter(Boolean);
  const q = u.searchParams;
  const out = {
    isFacebook: true,
    inputUrl: input,
    normalizedUrl: `https://www.facebook.com${u.pathname}${u.search}`,
    kind: 'unknown',
    account: { type: 'unknown', handle: null, numericId: null, displayHint: null, url: null },
    postId: null,
    signals: [],   // url-derived heuristic keys, consumed by accountRiskSignals
    notes: [],      // human-readable caveats about what the URL does / doesn't tell us
  };

  const head = (segs[0] || '').toLowerCase();

  // fb.watch/<token> and /watch/?v= — a video; origin account not in the URL.
  if (host === 'fb.watch' || head === 'watch') {
    out.kind = 'watch';
    out.postId = q.get('v') || segs[1] || null;
    out.notes.push('Watch/video link — the posting account is not encoded in this URL; open it to read the page name.');
    out.signals.push('origin_not_in_url');
    return out;
  }

  // /share/p/<token>, /share/v/<token>, /share/<token> — obscured share links.
  if (head === 'share') {
    out.kind = 'share_link';
    out.notes.push('Facebook "share" link — the real account and post are hidden behind a redirect token. Resolve it (open in a browser) to see the origin.');
    out.signals.push('origin_obscured_share');
    return out;
  }

  // profile.php?id=<numeric> — a personal profile with NO vanity URL.
  if (head === 'profile.php') {
    const id = q.get('id');
    out.kind = 'profile_numeric';
    out.account = { type: 'profile', handle: null, numericId: id || null,
      displayHint: null, url: id ? `https://www.facebook.com/profile.php?id=${id}` : null };
    out.signals.push('numeric_profile_no_vanity');
    out.notes.push('Personal profile addressed by numeric ID (no custom username) — common for newer or low-footprint accounts.');
    return out;
  }

  // permalink.php / story.php / photo.php — post id in story_fbid/fbid, actor in id.
  if (head === 'permalink.php' || head === 'story.php' || head === 'photo.php') {
    const actor = q.get('id');
    out.kind = 'permalink';
    out.postId = q.get('story_fbid') || q.get('fbid') || null;
    out.account = { type: 'unknown', handle: null, numericId: actor || null,
      displayHint: null, url: actor ? `https://www.facebook.com/profile.php?id=${actor}` : null };
    if (actor) out.signals.push('numeric_profile_no_vanity');
    out.isPermalink = true;   // resolve the real author from the post itself
    return out;
  }

  // /photo/?fbid=… / /media/… — a photo/media permalink. The posting account is
  // NOT in the URL, but we can read it from the post (enrichment resolves it).
  if (head === 'photo' || head === 'media') {
    out.kind = 'photo';
    out.postId = q.get('fbid') || segs[1] || null;
    out.signals.push('permalink_no_handle');
    out.notes.push('Photo/media permalink — the posting account is not in this URL; we read it from the post itself.');
    out.isPermalink = true;
    return out;
  }

  // /groups/<gid>/posts|permalink/<postId> — posted inside a group.
  if (head === 'groups') {
    out.kind = 'group_post';
    out.account = { type: 'group', handle: segs[1] || null, numericId: /^\d+$/.test(segs[1] || '') ? segs[1] : null,
      displayHint: null, url: segs[1] ? `https://www.facebook.com/groups/${segs[1]}` : null };
    out.postId = segs[3] || null;
    out.signals.push('posted_in_group');
    out.notes.push('Posted inside a Facebook group — the group, not a single page, is the container; the individual author may differ.');
    return out;
  }

  // /people/<Name>/<numericId> — profile with a name slug + numeric id.
  if (head === 'people') {
    out.kind = 'profile_numeric';
    const nameSlug = segs[1] ? decodeURIComponent(segs[1]).replace(/-/g, ' ') : null;
    out.account = { type: 'profile', handle: null, numericId: /^\d+$/.test(segs[2] || '') ? segs[2] : null,
      displayHint: nameSlug, url: out.normalizedUrl };
    out.signals.push('numeric_profile_no_vanity');
    return out;
  }

  if (head === 'reel' || head === 'reels') {
    out.kind = 'reel';
    out.postId = segs[1] || null;
    out.notes.push('Reel link — the posting account is not reliably encoded in the URL; open it to read the page name.');
    out.signals.push('origin_not_in_url');
    return out;
  }

  // /<vanity>/...  — a page or profile addressed by its custom username.
  if (head && !RESERVED.has(head)) {
    const vanity = segs[0];
    const sub = (segs[1] || '').toLowerCase();
    out.account = {
      type: 'page',     // vanity URLs are pages or vanity profiles; treat as page-like
      handle: vanity,
      numericId: null,
      displayHint: prettifyHandle(vanity),
      url: `https://www.facebook.com/${vanity}`,
    };
    out.signals.push('vanity_handle');
    if (sub === 'posts' || sub === 'videos' || sub === 'photos') {
      out.kind = `${sub === 'posts' ? 'page' : sub}_vanity`;
      out.postId = segs[2] || null;
    } else {
      out.kind = 'page_vanity';
    }
    if (/^\d{6,}$/.test(vanity)) {
      // a bare numeric "vanity" is really a numeric id, not a chosen username
      out.account.numericId = vanity;
      out.account.handle = null;
      out.signals = out.signals.filter((s) => s !== 'vanity_handle');
      out.signals.push('numeric_profile_no_vanity');
    }
    return out;
  }

  return out;
}

function prettifyHandle(handle) {
  if (!handle) return null;
  return handle.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

// ─── Resolving obscured links (share / watch / reel) ─────────────────
// A facebook.com/share/<token> link hides the real account+post behind a
// redirect. Unauthenticated www.facebook.com 400s, but MBASIC 302s the token
// straight to the canonical post URL before it hits the login wall — so we can
// recover the true origin server-side, no login, no scraping. Best-effort: any
// failure degrades to { resolved:false } and the caller keeps the old behaviour.

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// Kinds whose origin is NOT in the URL and is worth resolving via redirect.
export const OBSCURED_KINDS = new Set(['share_link', 'watch', 'reel']);

/** Strip Facebook tracking params and normalise to www — keep only identifying ones. */
export function cleanCanonicalUrl(input) {
  let u;
  try { u = new URL(String(input)); } catch { return null; }
  u.protocol = 'https:';
  u.hostname = 'www.facebook.com';
  for (const k of [...u.searchParams.keys()]) {
    if (!/^(id|story_fbid|fbid|v)$/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

/**
 * Interpret a redirect Location while resolving a share link. Pure.
 * → { type:'canonical', url }  a real post/account URL — done.
 * → { type:'login', url? }     the login wall; url = destination from ?next= if present.
 * → { type:'follow', url }     another share/redirect hop — keep going.
 * → { type:'dead' }            nothing usable.
 */
export function interpretLocation(location, base) {
  let loc;
  try { loc = new URL(location, base); } catch { return { type: 'dead' }; }
  const path = loc.pathname.toLowerCase();
  if (path.includes('/login') || path.endsWith('/login.php')) {
    const next = loc.searchParams.get('next');
    if (next) {
      try {
        const n = new URL(next);
        const np = n.pathname.toLowerCase();
        if (!np.includes('/login') && !np.startsWith('/share') && np !== '/') {
          return { type: 'canonical', url: cleanCanonicalUrl(n.toString()) };
        }
      } catch { /* fall through */ }
    }
    return { type: 'login' };
  }
  if (path.startsWith('/share') || path === '/') return { type: 'follow', url: loc.toString() };
  return { type: 'canonical', url: cleanCanonicalUrl(loc.toString()) };
}

/**
 * Resolve an obscured Facebook link to its canonical post URL via the mbasic
 * redirect chain. Returns { resolved, url?, via?, reason? }. Never throws.
 */
export async function resolveFacebookShare(inputUrl, { timeoutMs = 8000, maxHops = 5, fetchImpl = fetch } = {}) {
  let u;
  try { u = new URL(String(inputUrl).trim()); } catch { return { resolved: false, reason: 'bad_url' }; }
  u.hostname = 'mbasic.facebook.com';   // the host that 302s the token before the wall
  u.protocol = 'https:';
  let current = u.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < maxHops; hop++) {
      const res = await fetchImpl(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      });
      const loc = res.headers.get('location');
      if (!loc) return { resolved: false, reason: 'no_redirect' };
      const step = interpretLocation(loc, current);
      if (step.type === 'canonical' && step.url) return { resolved: true, url: step.url, via: 'mbasic_redirect' };
      if (step.type === 'follow') { current = step.url; continue; }
      return { resolved: false, reason: step.type };   // login wall with no next, or dead
    }
    return { resolved: false, reason: 'max_hops' };
  } catch {
    return { resolved: false, reason: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Best-effort OpenGraph fetch ─────────────────────────────────────
// Returns { ok, blocked, title, description, image, siteName }. Never throws.

export async function fetchFacebookMeta(url, { timeoutMs = 8000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, blocked: false, reason: 'bad_url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // A real-browser UA — Facebook still usually returns a login/consent wall,
        // but public link previews sometimes render OG tags.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return { ok: false, blocked: res.status === 401 || res.status === 403, reason: `http_${res.status}` };
    const html = await res.text();
    const meta = {
      ok: true,
      blocked: /log in to continue|you must log in|login_form|__d\("LoginForm/i.test(html) && !og(html, 'og:title'),
      title: og(html, 'og:title'),
      description: og(html, 'og:description'),
      image: og(html, 'og:image'),
      siteName: og(html, 'og:site_name'),
    };
    return meta;
  } catch {
    return { ok: false, blocked: false, reason: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

function og(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = String(html).match(re);
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
  const m2 = String(html).match(re2);
  return m2 ? decodeEntities(m2[1]) : null;
}

function decodeEntities(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&nbsp;/g, ' ').trim();
}

// ─── Transparent heuristic risk panel ───────────────────────────────
// Pure function. `context` is the journalist's "add context" form, using the
// same Page Transparency fields as pages.js (created_date, admin_country,
// followers, following, name_history, ad_library_active, avatar_generic, verified).
// Returns descriptive flags only — no score, no FAKE/REAL verdict.

const ZAMBIA = /zambia|zambian/i;

export function accountRiskSignals(parsed, context = {}, posts = null) {
  const flags = [];
  const couldNotDetermine = [];
  const push = (signal, observation, weight) => flags.push({ signal, observation, weight });

  // ── Posting cadence (when recent posts were enriched) ──
  const cadence = postingCadenceSignals(posts);
  for (const f of cadence.flags) flags.push(f);

  // ── URL-derived (always available) ──
  const urlSignals = new Set(parsed?.signals || []);
  if (urlSignals.has('numeric_profile_no_vanity')) {
    push('identity', 'Account is addressed by a numeric ID with no chosen username — common for newer, throwaway, or low-footprint accounts (but also for people who never set one).', 'minor');
  }
  if (urlSignals.has('posted_in_group')) {
    push('container', 'Content was posted inside a Facebook group, so the group — not a single page — is the container. The individual author can differ from the group.', 'minor');
  }
  if (urlSignals.has('origin_obscured_share') || urlSignals.has('origin_not_in_url')) {
    push('opacity', 'The posting account is not encoded in this URL (share/watch/reel link). Origin must be resolved by opening the link before any judgement.', 'notable');
  }

  // ── Author type (from post-author resolution) ──
  if (context.account_type === 'profile') {
    push('identity', 'Posted by a personal profile, not a Facebook Page — Page Transparency (admin country, page age, ads) does not apply. Judge it as an individual account, and be wary of impersonation.', 'minor');
  }

  // ── Account age (journalist-supplied) ──
  const ageDays = daysSince(context.created_date);
  if (ageDays != null) {
    if (ageDays <= 90) push('age', `Account/page created very recently (~${ageDays} days ago). A brand-new account pushing political content during an election is worth scrutiny.`, ageDays <= 30 ? 'significant' : 'notable');
    else if (ageDays <= 365) push('age', `Account/page is under a year old (~${ageDays} days). Note for context, not alarming on its own.`, 'minor');
  } else {
    couldNotDetermine.push('Account/page creation date — not readable from the URL; add it from Facebook Page Transparency.');
  }

  // ── Admin country (journalist-supplied) ──
  const admin = (context.admin_country || '').trim();
  if (admin) {
    const countries = admin.split(/[,;/]|\band\b/i).map((c) => c.trim()).filter(Boolean);
    const foreign = countries.filter((c) => c && !ZAMBIA.test(c) && !/unknown|n\/?a/i.test(c));
    if (foreign.length && countries.length && !countries.some((c) => ZAMBIA.test(c))) {
      push('origin_geography', `Page Transparency lists admins only outside Zambia (${foreign.join(', ')}) for content aimed at a Zambian audience.`, foreign.length > 1 ? 'significant' : 'notable');
    } else if (foreign.length) {
      push('origin_geography', `Page Transparency lists admins in multiple countries including ${foreign.join(', ')} alongside Zambia.`, 'notable');
    }
  } else {
    couldNotDetermine.push('Admin country — not readable here; check Facebook Page Transparency → "Page managed from".');
  }

  // ── Follower / following ratio (journalist-supplied) ──
  const followers = toNum(context.followers);
  const following = toNum(context.following);
  if (followers != null && following != null) {
    if (following >= 500 && followers <= Math.max(50, following * 0.1)) {
      push('follower_ratio', `Follows many (${following}) but has few followers (${followers}) — a classic amplifier/follow-spam pattern.`, 'notable');
    }
  } else if (followers == null && following == null) {
    couldNotDetermine.push('Follower / following counts — not readable from the URL; add them if you can see the profile.');
  }

  // ── Name history (journalist-supplied) ──
  const history = Array.isArray(context.name_history)
    ? context.name_history.filter(Boolean)
    : String(context.name_history || '').split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  if (history.length >= 2) {
    push('identity_history', `Page has been renamed multiple times (${history.join(' → ')}). Repeated rebrands can mask an account's history.`, history.length >= 3 ? 'significant' : 'notable');
  }

  // ── Political ads from an opaque page (journalist-supplied) ──
  if (context.ad_library_active === true || context.ad_library_active === 'true') {
    push('paid_amplification', 'Facebook Ad Library shows active ads from this page — its reach is partly paid, not organic.', 'notable');
  }

  // ── Profile image (journalist judgement) ──
  if (context.avatar_generic === true || context.avatar_generic === 'true') {
    push('avatar', 'Journalist flagged the profile image as a stock/default/AI-looking photo — weak signal on its own; reverse-image-search it.', 'minor');
  }

  // ── Confirmed page owner (Facebook transparency, via enrichment) ──
  if (context.confirmed_owner) {
    flags.unshift({ signal: 'confirmed_owner', observation: `Facebook names a confirmed page owner: "${context.confirmed_owner}". An accountable legal entity is listed — check it matches the page's claimed identity and country.`, weight: 'reassuring' });
  }

  // ── Verification dampener ──
  const verified = context.verified === true || context.verified === 'true';
  if (verified) {
    flags.unshift({ signal: 'verified', observation: 'Account carries a Meta verification badge — reduces (does not eliminate) impersonation concern.', weight: 'reassuring' });
  }

  // ── Summary (descriptive, no verdict) ──
  const concernFlags = flags.filter((f) => f.weight === 'significant' || f.weight === 'notable');
  const sig = flags.filter((f) => f.weight === 'significant').length;
  let summary;
  if (!concernFlags.length) summary = 'No origin red flags surfaced from the URL and the context provided. Absence of signal is not a clean bill of health — most account-level data is not readable without logging in.';
  else if (sig) summary = `${concernFlags.length} origin signal(s) worth the editor's attention, ${sig} of them significant. Confirm with Page Transparency before acting.`;
  else summary = `${concernFlags.length} soft origin signal(s) — track, but nothing strong enough to act on alone.`;

  return {
    flags,
    could_not_determine: couldNotDetermine,
    summary,
    cadence: cadence.stats,
    counts: { total: flags.length, significant: sig, notable: flags.filter((f) => f.weight === 'notable').length },
  };
}

// Posting-cadence signals from a sample of recent posts. Descriptive only —
// high volume is normal for a news desk, so volume alone is never "significant";
// machine-like regularity is the sharper automation tell.
export function postingCadenceSignals(posts) {
  const times = (Array.isArray(posts) ? posts : [])
    .map((p) => (p?.timestamp ? Number(p.timestamp) : (p?.time ? Math.floor(Date.parse(p.time) / 1000) : null)))
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);
  if (times.length < 4) return { flags: [], stats: null };

  const spanSec = times[times.length - 1] - times[0];
  const spanDays = spanSec / 86400;
  const perDay = spanDays > 0 ? times.length / spanDays : times.length;
  const ivals = [];
  for (let i = 1; i < times.length; i++) ivals.push(times[i] - times[i - 1]);
  const mean = ivals.reduce((a, b) => a + b, 0) / ivals.length;
  const variance = ivals.reduce((a, b) => a + (b - mean) ** 2, 0) / ivals.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const hours = new Set(times.map((t) => new Date(t * 1000).getUTCHours()));

  const flags = [];
  if (perDay >= 30) flags.push({ signal: 'posting_volume', observation: `Very high posting volume — about ${Math.round(perDay)} posts/day in the sample. Normal for a news desk; unusual for a personal or single-issue page.`, weight: 'notable' });
  else if (perDay >= 12) flags.push({ signal: 'posting_volume', observation: `Active posting — about ${Math.round(perDay)} posts/day in the sample.`, weight: 'minor' });
  if (times.length >= 6 && cv < 0.2) flags.push({ signal: 'posting_regularity', observation: `Posts arrive at ${cv === 0 ? 'near-identical' : 'machine-like regular'} intervals (~${Math.round(mean / 60)} min apart, low variance). Worth checking for scheduling/automation.`, weight: 'notable' });
  if (hours.size >= 18) flags.push({ signal: 'round_the_clock', observation: `Posts span ${hours.size} different hours of the day in the sample — round-the-clock activity. (Timestamps are UTC; allow for the page's real timezone.)`, weight: 'minor' });

  return {
    flags,
    stats: {
      sampled: times.length,
      span_days: Math.round(spanDays * 10) / 10,
      per_day: Math.round(perDay * 10) / 10,
      mean_interval_min: Math.round(mean / 60),
      regularity_cv: Math.round(cv * 100) / 100,
      distinct_hours: hours.size,
    },
  };
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(String(dateStr));
  if (Number.isNaN(t)) return null;
  const d = Math.floor((Date.now() - t) / 86400000);
  return d >= 0 ? d : null;
}
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, '').replace(/k$/i, 'e3').replace(/m$/i, 'e6'));
  return Number.isFinite(n) ? Math.round(n) : null;
}
