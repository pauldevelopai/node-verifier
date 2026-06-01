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

export function accountRiskSignals(parsed, context = {}) {
  const flags = [];
  const couldNotDetermine = [];
  const push = (signal, observation, weight) => flags.push({ signal, observation, weight });

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
    counts: { total: flags.length, significant: sig, notable: flags.filter((f) => f.weight === 'notable').length },
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
