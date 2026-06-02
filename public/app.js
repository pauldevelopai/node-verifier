// Election Watch — dashboard JS
//
// Two modes, one app:
//   Verify mode  → existing claim-verification flow (corpus + history)
//   Listen mode  → origin analysis (watchlist + analyse + library + compare + brief)
//
// Plain vanilla, no framework. Verify routes hit /api/* (auto-mounted by
// the runtime); listener routes hit /api/listener/*.

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let pickedProvider = null;
  let currentMode = 'verify';
  let selectedPostIds = new Set();
  let libraryCache = [];
  let currentOrigin = null;   // { parsed, meta, risk, context } for the pasted source URL

  // ─── Boot ─────────────────────────────────────────────────────────

  async function boot() {
    // Always show the app; mountKeyUI() gates on top with a first-run key prompt
    // if no key is set, and wires the "change API key" link to the Settings modal.
    document.getElementById('app').style.display = 'block';
    wireApp();
    mountKeyUI();
    loadHistory();
  }

  // ─── Welcome screen ───────────────────────────────────────────────

  function wireWelcome() {
    $$('.provider-row button').forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedProvider = btn.dataset.provider;
        $$('.provider-row button').forEach((b) =>
          b.classList.toggle('selected', b === btn)
        );
      });
    });

    $('#welcome-save').addEventListener('click', async () => {
      const key = $('#welcome-key').value.trim();
      const err = $('#welcome-error');
      err.style.display = 'none';

      if (!pickedProvider) { err.textContent = 'Pick a provider first.'; err.style.display = 'block'; return; }
      if (!key) { err.textContent = 'Paste your API key.'; err.style.display = 'block'; return; }

      const btn = $('#welcome-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const result = await postJson('api/setup', { provider: pickedProvider, apiKey: key });
        if (!result.ok) {
          err.textContent = result.message || 'Could not save key.';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Save and continue';
          return;
        }
        location.reload();
      } catch (e) {
        err.textContent = 'Network error. Is the server still running?';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Save and continue';
      }
    });
  }

  // ─── Mode switching ───────────────────────────────────────────────

  function switchMode(mode) {
    currentMode = mode;
    $$('.mode-switch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $$('nav button.tab').forEach((b) => {
      const btnMode = b.dataset.mode;
      if (!btnMode) return; // Activity (no mode) always visible
      b.hidden = btnMode !== mode;
    });

    // If the currently-active tab is not visible in the new mode, switch
    // to the first visible tab.
    const activeBtn = $('nav button.tab.active');
    if (activeBtn && activeBtn.hidden) {
      const firstVisible = $$('nav button.tab').find((b) => !b.hidden);
      if (firstVisible) activateTab(firstVisible);
    }
  }

  // ─── Main app ─────────────────────────────────────────────────────

  function wireApp() {
    // Mode pills
    $$('.mode-switch button').forEach((b) =>
      b.addEventListener('click', () => switchMode(b.dataset.mode))
    );

    // Tabs
    $$('nav button.tab').forEach((btn) => {
      btn.addEventListener('click', () => activateTab(btn));
    });

    // (The "change API key" link is wired by mountKeyUI → opens the Settings modal.)

    // Verify mode actions
    $('#verify-btn').addEventListener('click', verifyClaim);
    $('#add-example-btn').addEventListener('click', addExample);
    $('#inspect-btn').addEventListener('click', () => inspectOrigin());
    $('#claim-url').addEventListener('blur', () => {
      const u = $('#claim-url').value.trim();
      if (u && !currentOrigin) inspectOrigin();   // auto-track once when a link is pasted
    });

    // Listen mode actions
    $('#add-page-btn').addEventListener('click', addWatchlistPage);
    $('#analyze-btn').addEventListener('click', analyzePost);
    $('#library-refresh').addEventListener('click', loadLibrary);
    $('#library-compare-btn').addEventListener('click', runComparison);
    $('#generate-brief-btn').addEventListener('click', generateBrief);

    // History sidebar + detail view
    $('#history-refresh').addEventListener('click', loadHistory);
    $('#detail-back').addEventListener('click', () => {
      const firstVisible = $$('nav button.tab').find((b) => !b.hidden);
      if (firstVisible) activateTab(firstVisible);
    });

    // "Image attached" confirmation under the file inputs
    wireImageInfo('#claim-image', '#claim-image-info');
    wireImageInfo('#post-image', '#post-image-info');
  }

  function wireImageInfo(inputSel, infoSel) {
    const input = $(inputSel), info = $(infoSel);
    if (!input || !info) return;
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (!f) { info.className = 'file-info'; info.innerHTML = ''; return; }
      const kb = Math.round(f.size / 1024);
      const url = URL.createObjectURL(f);
      info.className = 'file-info show';
      info.innerHTML = `<img src="${url}" alt="preview" /><span class="ok">✓ Image attached</span><span>${escapeHtml(f.name)} · ${kb} KB</span><button type="button" class="clear-img">remove</button>`;
      info.querySelector('.clear-img').addEventListener('click', () => {
        input.value = '';
        URL.revokeObjectURL(url);
        info.className = 'file-info'; info.innerHTML = '';
      });
    });
  }

  function activateTab(btn) {
    $$('nav button.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.panel').forEach((p) =>
      p.classList.toggle('active', p.id === 'panel-' + btn.dataset.panel)
    );

    const panel = btn.dataset.panel;
    if (panel === 'corpus') loadCorpus();
    if (panel === 'watchlist') loadWatchlist();
    if (panel === 'library') loadLibrary();
    if (panel === 'brief') loadBriefs();
  }

  // ─── Verify mode: claim verification ──────────────────────────────

  async function verifyClaim() {
    const claimText = $('#claim-text').value.trim();
    const file = $('#claim-image').files[0];
    const sourceUrl = $('#claim-url').value.trim();
    const status = $('#verify-status');
    const reportArea = $('#report-area');

    if (!claimText && !file) {
      // A FB link alone can't be verified — the post body isn't readable. Say why
      // and point the journalist at what to do, instead of a bare error.
      status.innerHTML = sourceUrl
        ? "Origin tracked — but to check whether it's <em>true</em>, the verifier needs the post's words. Facebook blocks reading the post body, so paste the claim here or upload a screenshot, then press Check this claim."
        : 'Provide claim text, an image, or both.';
      status.style.color = 'var(--tier-false)';
      $('#claim-text').focus();
      return;
    }

    $('#verify-btn').disabled = true;
    status.style.color = 'var(--muted)';
    status.textContent = 'Verifying… this usually takes 15–30 seconds.';
    reportArea.style.display = 'none';

    try {
      let imageBase64 = null;
      let imageMimeType = null;
      if (file) {
        imageBase64 = await fileToBase64(file);
        imageMimeType = file.type || 'image/jpeg';
      }

      // If the journalist tracked the source account, fold the latest context in
      // and send the whole origin packet so the verifier weighs it and stores it.
      let accountOrigin = null;
      if (currentOrigin && currentOrigin.parsed) {
        currentOrigin.context = gatherOriginContext();
        accountOrigin = currentOrigin;
      }

      // Prefer the resolved canonical post URL over a useless share token.
      const effectiveUrl = (currentOrigin?.resolution?.resolved && currentOrigin.resolution.url) || sourceUrl || null;

      const result = await postJson('api/brief', {
        claimText: claimText || null,
        imageBase64,
        imageMimeType,
        sourceUrl: effectiveUrl,
        accountOrigin,
      });

      if (!result.ok) {
        status.textContent = result.message || 'Verification failed.';
        status.style.color = 'var(--tier-false)';
        if (result.raw) {
          reportArea.style.display = 'block';
          reportArea.innerHTML = '<pre style="white-space:pre-wrap;font-size:0.85rem">' + escapeHtml(result.raw) + '</pre>';
        }
        return;
      }

      const fetched = result.source_fetched ? ' · source page fetched' : '';
      status.textContent = `Done. Checked the live web${fetched}. Corpus: ${result.corpus_size} example(s).`;
      renderReport(result.report, result.citations, result.claim_id);
      loadHistory();
    } catch (e) {
      status.textContent = 'Network error: ' + e.message;
      status.style.color = 'var(--tier-false)';
    } finally {
      $('#verify-btn').disabled = false;
    }
  }

  function renderReport(report, citations, resultId) {
    const area = $('#report-area');
    area.innerHTML = reportHtml(report, citations) + feedbackHtml();
    area.style.display = 'block';
    wireFeedback(area, 'verify', resultId);
  }

  function reportHtml(report, citations) {
    const tierClass = 'tier-' + (report.tier || '').replace(/ /g, '.');
    const matching = (report.matching_examples || [])
      .map((m) => `<li><code>${escapeHtml(m.filename)}</code> — ${escapeHtml(m.why_it_matches)}</li>`).join('');
    const reasoning = (report.reasoning_chain || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const checks = (report.further_checks || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    // Sources the model relied on: prefer the model's key_sources; supplement
    // with web-search citations the runtime captured (deduped by URL).
    const seen = new Set();
    const sourceItems = [];
    (report.key_sources || []).forEach((s) => {
      const url = (s.url || '').trim();
      if (url) seen.add(url);
      const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title || url)}</a>` : escapeHtml(s.title || 'Source');
      sourceItems.push(`<li>${link}${s.what_it_says ? ' — ' + escapeHtml(s.what_it_says) : ''}</li>`);
    });
    (citations || []).forEach((c) => {
      const url = (c.url || '').trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      sourceItems.push(`<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(c.title || url)}</a></li>`);
    });
    const sources = sourceItems.join('');

    return `
      <div class="section">
        <span class="tier-badge ${tierClass}">${escapeHtml(report.tier || '')}</span>
        <span style="margin-left:0.6rem;color:var(--muted);font-size:0.9rem">${escapeHtml(report.tier_reason || '')}</span>
      </div>
      <div class="section">
        <h3>Claim restated</h3>
        <div>${escapeHtml(report.claim_restated || '')}</div>
      </div>
      ${sources ? `<div class="section"><h3>Sources checked (live web)</h3><ul>${sources}</ul></div>` : ''}
      ${matching ? `<div class="section"><h3>Matching past examples</h3><ul>${matching}</ul></div>` : ''}
      ${reasoning ? `<div class="section"><h3>Reasoning</h3><ol>${reasoning}</ol></div>` : ''}
      ${checks ? `<div class="section"><h3>Further checks</h3><ul>${checks}</ul></div>` : ''}
      ${report.draft_response ? `<div class="section"><h3>Suggested draft response</h3><div class="draft">${escapeHtml(report.draft_response)}</div></div>` : ''}
    `;
  }

  // ─── Verify mode: source-account origin tracking (Facebook) ───────

  async function inspectOrigin() {
    const url = $('#claim-url').value.trim();
    const area = $('#origin-area');
    if (!url) { area.style.display = 'none'; currentOrigin = null; return; }

    const btn = $('#inspect-btn');
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = 'Tracking…';
    area.style.display = 'block';
    area.innerHTML = '<div class="origin-box"><span class="status-line">Identifying the account behind this link…</span></div>';

    try {
      // Re-use any context the journalist already typed (so re-runs keep it).
      const context = currentOrigin ? gatherOriginContext() : {};
      const data = await postJson('api/inspect', { url, context });
      if (!data.ok) {
        area.innerHTML = `<div class="origin-box"><span class="status-line" style="color:var(--tier-false)">${escapeHtml(data.message || 'Could not inspect this URL.')}</span></div>`;
        currentOrigin = null;
        return;
      }
      if (data.supported === false) {
        currentOrigin = null;
        area.innerHTML = `<div class="origin-box"><h3>Origin tracking</h3><div class="origin-note">${escapeHtml(data.message)}</div></div>`;
        return;
      }
      currentOrigin = {
        origin_id: data.origin_id || null,
        parsed: data.parsed,
        meta: data.meta,
        risk: data.risk,
        context: data.context || context,   // merged: enrichment + journalist (journalist wins)
        enrichment: data.enrichment || null,
        ads: data.ads || null,
        enrichment_status: data.enrichment_status || null,
      };
      renderOrigin();
      loadHistory();
    } catch (e) {
      area.innerHTML = `<div class="origin-box"><span class="status-line" style="color:var(--tier-false)">Network error: ${escapeHtml(e.message)}</span></div>`;
      currentOrigin = null;
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }

  function renderOrigin() {
    const area = $('#origin-area');
    const { parsed, meta, risk, context, enrichment, ads, resolution } = currentOrigin;
    const a = parsed.account || {};
    const who = a.displayHint || a.handle || (a.numericId ? 'ID ' + a.numericId : 'Unknown account');

    // Did we follow a share/watch/reel link through to the real post?
    const resolvedBanner = (resolution && resolution.resolved && resolution.url)
      ? `<div class="origin-note" style="color:var(--tier-verified)">✓ Followed the share link to the real post: <a href="${escapeHtml(resolution.url)}" target="_blank" rel="noreferrer">${escapeHtml(resolution.url)}</a></div>`
      : (resolution && !resolution.resolved)
        ? `<div class="origin-note">Tried to follow the share link but Facebook didn’t expose the destination (${escapeHtml(resolution.reason || 'blocked')}). Open it in a browser to see the origin.</div>`
        : '';

    // Bridge: tracking found WHERE it came from — now hand off to checking WHETHER
    // it's true. The post body usually can't be auto-read (Facebook login wall), so
    // unless enrichment supplied the text, the journalist pastes the claim/screenshot.
    const postText = (context && context.post_text) || '';
    const verifyCta = postText
      ? `<div class="section" style="margin-top:0.7rem"><h3>Now check if it's true</h3>
           <div class="origin-note">We have the post's text. Run it through the live-web + corpus check.</div>
           <div style="margin-top:0.5rem"><button class="primary" id="to-verify" type="button">Verify this post &rarr;</button></div></div>`
      : `<div class="section" style="margin-top:0.7rem"><h3>Now check if it's true</h3>
           <div class="origin-note">Tracking found <strong>where</strong> this came from. To check <strong>whether it's true</strong>, the verifier needs the post's words — Facebook blocks reading the post body automatically. Paste the claim in the box at the top (or upload a screenshot), then press <strong>Check this claim</strong>.</div>
           <div style="margin-top:0.5rem"><button class="secondary" id="to-verify" type="button">Go to the claim box &uarr;</button></div></div>`;

    const notes = (parsed.notes || []).map((n) => `<div class="origin-note">• ${escapeHtml(n)}</div>`).join('');

    // Provenance: did a hosted enrichment provider auto-fill the account data?
    const SOURCE_LABEL = { apify: 'Apify', brightdata: 'Bright Data' };
    const enrichLine = enrichment && enrichment.source
      ? `<div class="origin-note" style="color:var(--tier-verified)">✓ Account details auto-filled from ${escapeHtml(SOURCE_LABEL[enrichment.source] || enrichment.source)} (logged-off public data — no Facebook login). Confirm/adjust below.</div>`
      : '';

    // Political ads (Meta Ad Library API) — funded amplification signal.
    let adsBlock = '';
    if (ads && ads.available) {
      if (ads.ok && ads.count > 0) {
        const fund = ads.funders && ads.funders.length ? ` · funded by ${ads.funders.map(escapeHtml).join(', ')}` : '';
        const rows = (ads.sample || []).map((s) =>
          `<div class="origin-note">• ${escapeHtml(s.started || '')}${s.spend ? ' · spend ' + escapeHtml(s.spend) : ''}${s.impressions ? ' · impressions ' + escapeHtml(s.impressions) : ''}${s.snapshot_url ? ` · <a href="${escapeHtml(s.snapshot_url)}" target="_blank" rel="noreferrer">view ad</a>` : ''}</div>`
        ).join('');
        adsBlock = `<div class="section" style="margin-top:0.7rem"><h3>Political ads (Meta Ad Library · ${escapeHtml(ads.country || 'ZM')})</h3>
          <div class="origin-note"><strong>${ads.count}${ads.has_more ? '+' : ''} political/issue ad(s)</strong> from this page${fund}.</div>${rows}</div>`;
      } else if (ads.ok) {
        adsBlock = `<div class="section" style="margin-top:0.7rem"><h3>Political ads (Meta Ad Library)</h3><div class="origin-note">No political/issue ads found for this page in ${escapeHtml(ads.country || 'ZM')}.</div></div>`;
      }
    }

    let metaLine;
    if (meta && meta.blocked) metaLine = '<div class="origin-note">Facebook returned a login wall (expected) — no public preview available. The account identity above comes from the link itself.</div>';
    else if (meta && (meta.title || meta.siteName)) metaLine = `<div class="origin-note">Link preview: <strong>${escapeHtml(meta.title || meta.siteName)}</strong>${meta.description ? ' — ' + escapeHtml(truncate(meta.description, 140)) : ''}</div>`;
    else metaLine = '<div class="origin-note">No public preview available (Facebook blocks unauthenticated reads). Identity above is from the link.</div>';

    const flags = (risk.flags || []).map((f) =>
      `<div class="flag-row w-${escapeHtml(f.weight)}"><span class="wt">${escapeHtml(f.weight)} · ${escapeHtml(f.signal)}</span><div>${escapeHtml(f.observation)}</div></div>`
    ).join('') || '<div class="origin-note">No origin red flags from the link alone. Add context below to sharpen this.</div>';

    const cnd = (risk.could_not_determine || []).length
      ? `<div class="section"><h3>Not readable without logging in</h3>${risk.could_not_determine.map((c) => `<div class="origin-note">• ${escapeHtml(c)}</div>`).join('')}</div>`
      : '';

    const c = context || {};
    const hasContext = Object.values(c).some((v) => v === true || (typeof v === 'string' && v.trim()) || (Array.isArray(v) && v.length));
    area.innerHTML = `
      <div class="origin-box">
        <h3>Where this came from</h3>
        ${resolvedBanner}
        <div class="ident"><span class="who">${escapeHtml(who)}</span> <span class="pill">${escapeHtml(a.type || 'unknown')}</span> <span class="pill">${escapeHtml(parsed.kind)}</span>${context && context.category ? ` <span class="pill">${escapeHtml(context.category)}</span>` : ''}</div>
        ${a.url ? `<div class="url" style="font-size:0.8rem;margin-top:0.2rem"><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.url)}</a></div>` : ''}
        ${context && context.confirmed_owner ? `<div class="origin-note">Confirmed owner: <strong>${escapeHtml(context.confirmed_owner)}</strong></div>` : ''}
        ${context && context.post_text ? `<div class="origin-note">Post content (read from the post): “${escapeHtml(truncate(context.post_text, 240))}”</div>` : ''}
        ${notes}
        ${metaLine}
        ${enrichLine}

        <div class="section" style="margin-top:0.7rem"><h3>Account risk signals</h3>${flags}</div>
        ${risk.cadence ? `<div class="origin-note">Posting cadence (sample of ${risk.cadence.sampled}): ~${risk.cadence.per_day}/day · mean ${risk.cadence.mean_interval_min} min apart · spans ${risk.cadence.distinct_hours} hrs/day · regularity ${risk.cadence.regularity_cv}.</div>` : ''}
        <div class="origin-note" style="margin-top:0.3rem"><em>${escapeHtml(risk.summary || '')}</em></div>
        ${adsBlock}
        ${cnd}
        ${verifyCta}

        <details class="ctx"${hasContext ? ' open' : ''}>
          <summary>Add context — what you can see on the page (sharpens the signals)</summary>
          <div class="ctx-grid">
            <div class="row-flex">
              <div><label for="ctx-created">Page/account created</label><input type="text" id="ctx-created" placeholder="e.g. 2026-05-01" value="${escapeHtml(c.created_date || '')}" /></div>
              <div><label for="ctx-admin">Admin country (Page Transparency)</label><input type="text" id="ctx-admin" placeholder="e.g. Russia / Zambia / unknown" value="${escapeHtml(c.admin_country || '')}" /></div>
            </div>
            <div class="row-flex">
              <div><label for="ctx-followers">Followers</label><input type="text" id="ctx-followers" placeholder="e.g. 1200" value="${escapeHtml(c.followers || '')}" /></div>
              <div><label for="ctx-following">Following</label><input type="text" id="ctx-following" placeholder="e.g. 4000" value="${escapeHtml(c.following || '')}" /></div>
            </div>
            <label for="ctx-namehist">Name history (one per line — Facebook lists past names)</label>
            <textarea id="ctx-namehist" style="min-height:60px" placeholder="Past Page Name 1&#10;Past Page Name 2">${escapeHtml(Array.isArray(c.name_history) ? c.name_history.join('\n') : (c.name_history || ''))}</textarea>
            <label style="display:inline-flex;align-items:center;gap:0.5rem;font-weight:400;margin-right:1rem"><input type="checkbox" id="ctx-adlib" ${c.ad_library_active ? 'checked' : ''} /> Ad Library shows active ads</label>
            <label style="display:inline-flex;align-items:center;gap:0.5rem;font-weight:400;margin-right:1rem"><input type="checkbox" id="ctx-avatar" ${c.avatar_generic ? 'checked' : ''} /> Profile photo looks stock/default/AI</label>
            <label style="display:inline-flex;align-items:center;gap:0.5rem;font-weight:400"><input type="checkbox" id="ctx-verified" ${c.verified ? 'checked' : ''} /> Has a verification badge</label>
            <label for="ctx-notes" style="margin-top:0.5rem">Your notes (free text — included in the verification)</label>
            <textarea id="ctx-notes" style="min-height:60px" placeholder="Anything else you noticed about the account or post.">${escapeHtml(c.notes || '')}</textarea>
            <div style="margin-top:0.6rem"><button class="secondary" id="ctx-rerun" type="button">Re-check signals with this context</button></div>
          </div>
        </details>
        ${feedbackHtml()}
      </div>
    `;
    wireFeedback(area, 'origin', currentOrigin.origin_id, currentOrigin.feedback);
    $('#ctx-rerun')?.addEventListener('click', () => inspectOrigin());
    $('#to-verify')?.addEventListener('click', () => {
      const claimEl = $('#claim-text');
      if (postText) {
        // We already have the post's words — drop them in and run the check.
        if (!claimEl.value.trim()) claimEl.value = postText;
        verifyClaim();
      } else {
        // No readable body — send the journalist to the claim box to paste it.
        claimEl.focus();
        claimEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function gatherOriginContext() {
    if (!$('#ctx-created')) return (currentOrigin && currentOrigin.context) || {};
    return {
      created_date: $('#ctx-created').value.trim(),
      admin_country: $('#ctx-admin').value.trim(),
      followers: $('#ctx-followers').value.trim(),
      following: $('#ctx-following').value.trim(),
      name_history: $('#ctx-namehist').value,
      ad_library_active: $('#ctx-adlib').checked,
      avatar_generic: $('#ctx-avatar').checked,
      verified: $('#ctx-verified').checked,
      notes: $('#ctx-notes').value.trim(),
    };
  }

  async function loadCorpus() {
    const status = $('#corpus-status');
    const list = $('#corpus-list');
    status.textContent = 'Loading…';
    list.innerHTML = '';
    const result = await fetchJson('api/sources');
    if (result.corpus_size === 0) {
      status.innerHTML = '<span class="empty">No examples yet. Add the first one below.</span>';
      return;
    }
    status.textContent = `${result.corpus_size} example(s) in corpus.`;
    result.files.forEach((f) => {
      const li = document.createElement('li');
      li.textContent = `${f.filename} (${f.bytes} bytes)`;
      list.appendChild(li);
    });
  }

  async function addExample() {
    const filename = $('#example-filename').value.trim();
    const content = $('#example-content').value.trim();
    if (!filename || !content) { alert('Both filename and content are required.'); return; }
    const finalName = filename.endsWith('.txt') ? filename : filename + '.txt';
    const result = await postJson('api/ingest', { filename: finalName, content });
    if (result.ok) {
      $('#example-filename').value = '';
      $('#example-content').value = '';
      loadCorpus();
    } else {
      alert('Could not save: ' + (result.error || 'unknown error'));
    }
  }

  // ─── History sidebar (all result types, clickable to full detail) ──
  const FB_ICON = { approve: '👍', disapprove: '👎' };
  let historyIndex = {};   // `${type}:${id}` → full item (incl. detail), for click

  async function loadHistory() {
    const body = $('#history-rail-body');
    try {
      const data = await fetchJson('api/history');
      renderHistoryRail(data.groups || []);
    } catch (e) {
      body.innerHTML = '<div class="rail-empty">Could not load history.</div>';
    }
  }

  function renderHistoryRail(groups) {
    const body = $('#history-rail-body');
    historyIndex = {};
    const total = groups.reduce((n, g) => n + ((g.items && g.items.length) || 0), 0);
    if (!total) { body.innerHTML = '<div class="rail-empty">No queries yet. Your results will appear here.</div>'; return; }
    body.innerHTML = '';
    groups.forEach((g) => {
      if (!g.items || !g.items.length) return;
      const h = document.createElement('div');
      h.className = 'rail-group-title';
      h.textContent = `${g.label} · ${g.items.length}`;
      body.appendChild(h);
      g.items.forEach((it) => {
        const key = `${g.type}:${it.id}`;
        historyIndex[key] = { ...it, type: g.type };
        const btn = document.createElement('button');
        btn.className = 'rail-item';
        btn.type = 'button';
        btn.dataset.key = key;
        const when = it.when ? new Date(it.when).toLocaleDateString() : '';
        const fb = it.feedback && it.feedback.verdict ? `<span class="ri-fb" title="You rated this">${FB_ICON[it.feedback.verdict] || ''}</span>` : '';
        btn.innerHTML = `
          <div class="ri-title">${escapeHtml(truncate(it.title || '(untitled)', 90))}</div>
          <div class="ri-meta">${it.badge ? `<span class="ri-badge">${escapeHtml(it.badge)}</span>` : ''}<span>${escapeHtml(when)}</span>${fb}</div>`;
        btn.addEventListener('click', () => openHistoryDetail(key, btn));
        body.appendChild(btn);
      });
    });
  }

  function openHistoryDetail(key, btn) {
    const item = historyIndex[key];
    if (!item) return;
    $$('.rail-item').forEach((b) => b.classList.toggle('active', b === btn));
    const body = $('#detail-body');
    body.innerHTML = detailHtmlFor(item) + feedbackHtml();
    showDetailPanel();
    // history type strings match the judge result_type values exactly.
    wireFeedback(body, item.type, item.id, item.feedback);
  }

  function showDetailPanel() {
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-detail'));
    $$('nav button.tab').forEach((b) => b.classList.remove('active'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function detailHtmlFor(item) {
    const d = item.detail || {};
    const when = item.when ? new Date(item.when).toLocaleString() : '';
    const head = (kind, title) =>
      `<div style="margin-bottom:0.6rem"><span class="pill">${escapeHtml(kind)}</span> <span style="color:var(--muted);font-size:0.82rem">${escapeHtml(when)}</span><h2 style="margin:0.4rem 0 0">${escapeHtml(title)}</h2></div>`;
    if (item.type === 'verify') {
      const src = d.source_url ? `<div class="origin-note">Source: <a href="${escapeHtml(d.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(d.source_url)}</a></div>` : '';
      const ao = d.account_origin;
      const origin = ao ? originDetailHtml({ account: ao.parsed?.account, notes: ao.parsed?.notes, risk_summary: ao.risk?.summary, context: ao.context }) : '';
      return head('Claim check', d.report?.claim_restated || d.claim_text || '(image only)') + src + reportHtml(d.report || {}, d.citations || []) + origin;
    }
    if (item.type === 'origin') return head('Origin track', item.title) + originDetailHtml(d);
    if (item.type === 'listen_analyze') {
      const txt = d.post_text ? `<div class="origin-note">“${escapeHtml(truncate(d.post_text, 400))}”</div>` : '';
      return head('Post analysis', item.title) + txt + riskProfileHtml(d.risk_profile || {});
    }
    if (item.type === 'listen_compare') return head('Comparison', item.title) + comparisonHtml(d.comparison || {});
    return '<div class="empty">Nothing to show.</div>';
  }

  function originDetailHtml(o) {
    if (!o) return '';
    const a = o.account || {};
    const who = a.displayHint || a.handle || a.url || 'account';
    const notes = (o.notes || []).map((n) => `<div class="origin-note">• ${escapeHtml(n)}</div>`).join('');
    const c = o.context || {};
    const rows = [];
    if (c.admin_country) rows.push(`Admin country: ${c.admin_country}`);
    if (c.created_date) rows.push(`Created: ${c.created_date}`);
    if (c.followers || c.following) rows.push(`Followers/following: ${c.followers ?? '?'} / ${c.following ?? '?'}`);
    if (c.confirmed_owner) rows.push(`Confirmed owner: ${c.confirmed_owner}`);
    const ctx = rows.length ? `<div class="origin-note">${rows.map(escapeHtml).join(' · ')}</div>` : '';
    return `<div class="origin-box" style="margin-top:0.8rem">
      <h3>Where this came from</h3>
      <div class="ident"><span class="who">${escapeHtml(who)}</span>${a.type ? ` <span class="pill">${escapeHtml(a.type)}</span>` : ''}</div>
      ${a.url ? `<div class="url" style="font-size:0.8rem;margin-top:0.2rem"><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.url)}</a></div>` : ''}
      ${ctx}${notes}
      ${o.risk_summary ? `<div class="origin-note" style="margin-top:0.3rem"><em>${escapeHtml(o.risk_summary)}</em></div>` : ''}
    </div>`;
  }

  // ─── Listen mode: watchlist ──────────────────────────────────────

  async function loadWatchlist() {
    const status = $('#watchlist-status');
    const list = $('#watchlist-list');
    status.textContent = 'Loading…';
    list.innerHTML = '';
    const result = await fetchJson('api/listener/pages');
    const pages = result.pages || [];
    if (!pages.length) {
      status.innerHTML = '<span class="empty">Watchlist is empty. Add the first page below.</span>';
      return;
    }
    status.textContent = `${pages.length} page(s) on the watchlist.`;
    pages.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'page-card';
      const history = (p.name_history && p.name_history.length)
        ? `<div class="meta"><strong>Name history:</strong> ${p.name_history.map(escapeHtml).join(' → ')}</div>` : '';
      div.innerHTML = `
        <div class="top">
          <div>
            <div class="name">${escapeHtml(p.name)}</div>
            <div class="url">${escapeHtml(p.url)}</div>
            <div class="meta">
              <span class="pill">Admin: ${escapeHtml(p.admin_country || 'unknown')}</span>
              <span class="pill">Created: ${escapeHtml(p.created_date || 'unknown')}</span>
              <span class="pill">${p.ad_library_active ? 'Ad Library active' : 'No active ads'}</span>
            </div>
            ${history}
            ${p.notes ? `<div class="meta" style="margin-top:0.3rem">${escapeHtml(p.notes)}</div>` : ''}
          </div>
          <button class="danger" data-page-id="${p.id}">Remove</button>
        </div>
      `;
      div.querySelector('button.danger').addEventListener('click', () => removeWatchlistPage(p.id));
      list.appendChild(div);
    });
  }

  async function addWatchlistPage() {
    const body = {
      name: $('#page-name').value,
      url: $('#page-url').value,
      admin_country: $('#page-admin-country').value,
      created_date: $('#page-created').value,
      name_history: $('#page-name-history').value,
      notes: $('#page-notes').value,
      ad_library_active: $('#page-ad-library').checked,
    };
    const result = await postJson('api/listener/pages', body);
    if (!result.ok) {
      alert(result.message || 'Could not add page.');
      return;
    }
    ['#page-name', '#page-url', '#page-admin-country', '#page-created', '#page-name-history', '#page-notes']
      .forEach((sel) => { $(sel).value = ''; });
    $('#page-ad-library').checked = false;
    loadWatchlist();
  }

  async function removeWatchlistPage(id) {
    if (!confirm('Remove this page from the watchlist?')) return;
    const r = await fetch('api/listener/pages/' + encodeURIComponent(id), { method: 'DELETE' });
    if (r.ok) loadWatchlist();
  }

  // ─── Listen mode: analyse a post ─────────────────────────────────

  async function analyzePost() {
    const postText = $('#post-text').value.trim();
    const pageUrl = $('#post-page-url').value.trim();
    const postUrl = $('#post-url').value.trim();
    const journalistNotes = $('#post-notes').value.trim();
    const file = $('#post-image') ? $('#post-image').files[0] : null;
    const status = $('#analyze-status');
    const area = $('#profile-area');

    if (!postText && !file) {
      status.textContent = 'Paste the post text or attach a screenshot.';
      status.style.color = 'var(--tier-false)';
      return;
    }

    $('#analyze-btn').disabled = true;
    status.style.color = 'var(--muted)';
    status.textContent = 'Analysing… this usually takes 15–30 seconds.';
    area.style.display = 'none';

    try {
      let imageBase64 = null;
      let imageMimeType = null;
      if (file) {
        imageBase64 = await fileToBase64(file);
        imageMimeType = file.type || 'image/jpeg';
      }
      const result = await postJson('api/listener/analyze', { postText, pageUrl, postUrl, journalistNotes, imageBase64, imageMimeType });
      if (!result.ok) {
        status.textContent = result.message || 'Analysis failed.';
        status.style.color = 'var(--tier-false)';
        if (result.raw) {
          area.style.display = 'block';
          area.innerHTML = '<pre style="white-space:pre-wrap;font-size:0.85rem">' + escapeHtml(result.raw) + '</pre>';
        }
        return;
      }
      status.textContent = `Done. Saved to Library.`;
      renderRiskProfile(result.profile, result.stored_id);
      loadHistory();
    } catch (e) {
      status.textContent = 'Network error: ' + e.message;
      status.style.color = 'var(--tier-false)';
    } finally {
      $('#analyze-btn').disabled = false;
    }
  }

  function renderRiskProfile(profile, resultId) {
    const area = $('#profile-area');
    area.innerHTML = riskProfileHtml(profile) + feedbackHtml();
    area.style.display = 'block';
    wireFeedback(area, 'listen_analyze', resultId);
  }

  function riskProfileHtml(profile) {
    const confClass = 'conf-' + (profile.confidence || '').replace(/ /g, '.');
    const flags = (profile.flags || []).map((f) => `
      <div class="flag-row">
        <div class="cat">${escapeHtml(f.category)} · ${escapeHtml(f.weight || '')}</div>
        <div>${escapeHtml(f.observation)}</div>
      </div>
    `).join('');
    const why = (profile.why_chain || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const checks = (profile.further_checks || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    return `
      <div class="section">
        <span class="conf-badge ${confClass}">${escapeHtml(profile.confidence || '')}</span>
        <span style="margin-left:0.6rem;color:var(--muted);font-size:0.9rem">${escapeHtml(profile.confidence_reason || '')}</span>
      </div>
      <div class="section">
        <h3>Post restated</h3>
        <div>${escapeHtml(profile.post_restated || '')}</div>
      </div>
      ${flags ? `<div class="section"><h3>Flags</h3>${flags}</div>` : ''}
      ${why ? `<div class="section"><h3>Why-chain</h3><ol>${why}</ol></div>` : ''}
      ${checks ? `<div class="section"><h3>Further checks</h3><ul>${checks}</ul></div>` : ''}
      ${profile.what_NOT_to_publish ? `<div class="section"><h3>What NOT to publish</h3><div class="warn">${escapeHtml(profile.what_NOT_to_publish)}</div></div>` : ''}
      ${profile.editorial_lead ? `<div class="section"><h3>Editorial lead</h3><div class="draft">${escapeHtml(profile.editorial_lead)}</div></div>` : ''}
    `;
  }

  // ─── Listen mode: library + compare ──────────────────────────────

  async function loadLibrary() {
    const status = $('#library-status');
    const list = $('#library-list');
    status.textContent = 'Loading…';
    list.innerHTML = '';
    const result = await fetchJson('api/listener/posts');
    const posts = result.posts || [];
    libraryCache = posts;
    selectedPostIds.clear();
    updateSelectedCount();

    if (!posts.length) {
      status.innerHTML = '<span class="empty">No posts analysed yet. Use the "Analyse a post" tab.</span>';
      return;
    }
    status.textContent = `Showing ${posts.length} analysed post(s), most recent first.`;
    posts.forEach((p) => {
      const conf = p.risk_profile?.confidence || '—';
      const confClass = 'conf-' + conf.replace(/ /g, '.');
      const div = document.createElement('div');
      div.className = 'post-row';
      div.innerHTML = `
        <div class="when">${new Date(p.analyzed_at).toLocaleString()} · ${escapeHtml(p.page_url || 'unknown page')}</div>
        <div class="text">${escapeHtml(truncate(p.post_text, 280))}</div>
        <div class="meta">
          <span class="conf-badge ${confClass}">${escapeHtml(conf)}</span>
          ${p.risk_profile?.post_restated ? '· ' + escapeHtml(p.risk_profile.post_restated) : ''}
        </div>
        <label>
          <input type="checkbox" data-post-id="${p.id}" /> Include in next comparison
        </label>
      `;
      div.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
        if (e.target.checked) selectedPostIds.add(p.id);
        else selectedPostIds.delete(p.id);
        updateSelectedCount();
      });
      list.appendChild(div);
    });
  }

  function updateSelectedCount() {
    $('#library-selected').textContent = selectedPostIds.size
      ? `${selectedPostIds.size} selected for comparison.`
      : '';
  }

  async function runComparison() {
    if (selectedPostIds.size < 2) {
      alert('Pick at least two posts on the Library tab before running a comparison.');
      return;
    }
    // Switch to the Compare tab
    const compareTab = $('nav button.tab[data-panel="compare"]');
    activateTab(compareTab);

    const status = $('#compare-status');
    const area = $('#compare-area');
    status.style.color = 'var(--muted)';
    status.textContent = `Comparing ${selectedPostIds.size} post(s)… this usually takes 15–30 seconds.`;
    area.style.display = 'none';

    const result = await postJson('api/listener/compare', { postIds: Array.from(selectedPostIds) });
    if (!result.ok) {
      status.textContent = result.message || 'Comparison failed.';
      status.style.color = 'var(--tier-false)';
      if (result.raw) {
        area.style.display = 'block';
        area.innerHTML = '<pre style="white-space:pre-wrap;font-size:0.85rem">' + escapeHtml(result.raw) + '</pre>';
      }
      return;
    }
    status.textContent = `Compared ${selectedPostIds.size} posts.`;
    renderComparison(result.comparison, result.comparison_id);
    loadHistory();
  }

  function renderComparison(c, resultId) {
    const area = $('#compare-area');
    area.innerHTML = comparisonHtml(c) + feedbackHtml();
    area.style.display = 'block';
    wireFeedback(area, 'listen_compare', resultId);
  }

  function comparisonHtml(c) {
    const verdictClass = 'conf-' + (c.verdict || '').replace(/ /g, '.');
    const overlap = (c.overlap_findings || []).map((f) => `
      <div class="flag-row">
        <div class="cat">${escapeHtml(f.type)}</div>
        <div>${escapeHtml(f.evidence)}</div>
        <div class="meta">Affects: ${(f.posts_affected || []).map(escapeHtml).join(', ')}</div>
      </div>
    `).join('');
    const divergences = (c.divergences || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const checks = (c.further_checks || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    return `
      <div class="section">
        <span class="conf-badge ${verdictClass}">${escapeHtml(c.verdict || '')}</span>
        <span style="margin-left:0.6rem;color:var(--muted);font-size:0.9rem">${escapeHtml(c.verdict_reason || '')}</span>
      </div>
      <div class="section"><h3>Top line</h3><div>${escapeHtml(c.summary || '')}</div></div>
      ${overlap ? `<div class="section"><h3>Overlap findings</h3>${overlap}</div>` : ''}
      ${divergences ? `<div class="section"><h3>Divergences (against the coordination read)</h3><ul>${divergences}</ul></div>` : ''}
      ${checks ? `<div class="section"><h3>Further checks</h3><ul>${checks}</ul></div>` : ''}
      ${c.publishable_now ? `<div class="section"><h3>What's publishable now</h3><div class="draft">${escapeHtml(c.publishable_now)}</div></div>` : ''}
    `;
  }

  // ─── Listen mode: weekly brief ───────────────────────────────────

  async function generateBrief() {
    const days = parseInt($('#brief-days').value, 10) || 7;
    const status = $('#brief-status');
    const area = $('#brief-area');
    status.style.color = 'var(--muted)';
    status.textContent = 'Generating brief…';
    area.style.display = 'none';
    $('#generate-brief-btn').disabled = true;

    try {
      const result = await postJson('api/listener/brief', { days });
      if (!result.ok) {
        status.textContent = result.message || 'Brief failed.';
        status.style.color = 'var(--tier-false)';
        if (result.raw) {
          area.style.display = 'block';
          area.innerHTML = '<pre style="white-space:pre-wrap;font-size:0.85rem">' + escapeHtml(result.raw) + '</pre>';
        }
        return;
      }
      status.textContent = `Brief for ${result.period_start} → ${result.period_end} ready.`;
      renderBrief(result);
      loadBriefs();
    } finally {
      $('#generate-brief-btn').disabled = false;
    }
  }

  function renderBrief(result) {
    const b = result.brief;
    const area = $('#brief-area');
    const patterns = (b.patterns_observed || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const shifts = (b.shifts_from_previous || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const pages = (b.pages_of_concern || []).map((p) => `<li><strong>${escapeHtml(p.page)}</strong> — ${escapeHtml(p.why)}</li>`).join('');
    const leads = (b.story_leads || []).map((l) => `<li><strong>${escapeHtml(l.angle)}</strong> — ${escapeHtml(l.what_to_do_next)}</li>`).join('');

    area.innerHTML = `
      <div class="brief-block">
        <h3>${escapeHtml(b.headline || '')}</h3>
        <div class="meta">${result.period_start} → ${result.period_end} · ${result.posts_count} post(s) analysed</div>
      </div>
      ${patterns ? `<div class="section"><h3>Patterns observed</h3><ul>${patterns}</ul></div>` : ''}
      ${shifts ? `<div class="section"><h3>Shifts from previous period</h3><ul>${shifts}</ul></div>` : ''}
      ${pages ? `<div class="section"><h3>Pages of concern</h3><ul>${pages}</ul></div>` : ''}
      ${leads ? `<div class="section"><h3>Story leads</h3><ul>${leads}</ul></div>` : ''}
      ${b.what_NOT_to_publish_yet ? `<div class="section"><h3>What NOT to publish yet</h3><div class="warn">${escapeHtml(b.what_NOT_to_publish_yet)}</div></div>` : ''}
      <div class="section">
        <h3>Stats</h3>
        <div class="metric-grid">
          <div class="metric"><div class="label">Posts</div><div class="value">${b.stats?.posts_analysed ?? '—'}</div></div>
          <div class="metric"><div class="label">Highly coordinated</div><div class="value">${b.stats?.highly_coordinated_count ?? '—'}</div></div>
          <div class="metric"><div class="label">Strong signals</div><div class="value">${b.stats?.strong_signals_count ?? '—'}</div></div>
        </div>
      </div>
    `;
    area.style.display = 'block';
  }

  async function loadBriefs() {
    const list = $('#briefs-list');
    list.innerHTML = '<span class="status-line">Loading…</span>';
    const result = await fetchJson('api/listener/briefs');
    const briefs = result.briefs || [];
    if (!briefs.length) {
      list.innerHTML = '<span class="empty">No past briefs yet.</span>';
      return;
    }
    list.innerHTML = '';
    briefs.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'brief-block';
      div.innerHTML = `
        <h3>${escapeHtml(r.brief?.headline || 'Brief')}</h3>
        <div class="meta">${r.period_start} → ${r.period_end} · ${r.posts_count} post(s) · generated ${new Date(r.timestamp).toLocaleString()}</div>
      `;
      list.appendChild(div);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  async function fetchJson(url) {
    const r = await fetch(url);
    return r.json();
  }

  async function postJson(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ─── Approve / disapprove on a result → the learning DB (/api/judge) ──
  // Every result type gets the same control. Approve confirms the result (and,
  // for claims/posts, promotes it into the trusted corpus). Disapprove opens a
  // correction box; the note is fed into future similar checks.
  function feedbackHtml() {
    return `
      <div class="result-feedback" data-fb>
        <span class="fb-q">Was this useful and correct?</span>
        <button class="fb-btn approve" data-fb-verdict="approve" type="button">👍 Approve</button>
        <button class="fb-btn disapprove" data-fb-verdict="disapprove" type="button">👎 Disapprove</button>
        <div class="fb-correction" data-fb-correction>
          <textarea placeholder="What was wrong? Your correction trains the Node (optional)."></textarea>
          <div style="margin-top:0.4rem"><button class="secondary" data-fb-submit type="button">Save correction</button></div>
        </div>
        <span class="fb-learn">Your rating is stored and fed into future similar checks — approvals also become trusted examples.</span>
      </div>`;
  }

  function wireFeedback(container, resultType, resultId, existing) {
    const root = container && container.querySelector('[data-fb]');
    if (!root) return;
    if (!resultId) { root.remove(); return; }   // nothing to attach a verdict to
    const approveBtn = root.querySelector('.fb-btn.approve');
    const disapproveBtn = root.querySelector('.fb-btn.disapprove');
    const corr = root.querySelector('[data-fb-correction]');
    const corrText = corr.querySelector('textarea');
    const learn = root.querySelector('.fb-learn');
    let current = existing && existing.verdict ? existing.verdict : null;
    if (existing && existing.correction) corrText.value = existing.correction;

    const paint = () => {
      approveBtn.classList.toggle('active', current === 'approve');
      disapproveBtn.classList.toggle('active', current === 'disapprove');
      corr.style.display = current === 'disapprove' ? 'block' : 'none';
    };
    paint();

    async function send(verdict) {
      current = verdict;
      paint();
      try {
        const r = await postJson('api/judge', {
          result_type: resultType, result_id: resultId, verdict,
          correction: corrText.value.trim() || null,
        });
        if (r && r.ok) {
          learn.textContent = verdict === 'approve'
            ? (r.promoted ? '✓ Saved — added to the trusted corpus and the learning record.' : '✓ Saved to the Node’s learning record.')
            : '✓ Correction saved — the Node will weigh this next time.';
        } else {
          learn.textContent = (r && r.message) || 'Could not save that rating.';
        }
      } catch (e) {
        learn.textContent = 'Network error saving the rating.';
      }
    }

    approveBtn.addEventListener('click', () => send('approve'));
    disapproveBtn.addEventListener('click', () => { current = 'disapprove'; paint(); corrText.focus(); send('disapprove'); });
    corr.querySelector('[data-fb-submit]').addEventListener('click', () => send('disapprove'));
  }

  // ─── Reusable API-key UX (shared across Nodes — keep in sync with node-template) ──
  function mountKeyUI(opts = {}) {
    const PROVIDERS = { anthropic: { label: 'Anthropic (Claude)', link: 'https://console.anthropic.com/', hint: 'sk-ant-…' },
                        openai:    { label: 'OpenAI (GPT)',       link: 'https://platform.openai.com/api-keys', hint: 'sk-…' } };
    let picked = 'anthropic';
    const style = document.createElement('style');
    style.textContent = `
      #gk-ov{position:fixed;inset:0;background:rgba(20,20,18,.45);display:none;align-items:center;justify-content:center;z-index:9999;padding:1rem}
      #gk-ov.open{display:flex}
      #gk-card{background:#fff;border:1px solid #e5e3da;border-radius:12px;max-width:440px;width:100%;padding:1.6rem 1.7rem;font-family:inherit;box-shadow:0 10px 40px rgba(0,0,0,.18)}
      #gk-card h2{margin:0 0 .35rem;font-size:1.2rem}#gk-card p{color:#6b6b66;font-size:.9rem;margin:.2rem 0 1rem}
      .gk-prov{display:flex;gap:.5rem;margin:.5rem 0 1rem}
      .gk-prov button{flex:1;padding:.6rem;border:1px solid #e5e3da;background:#fff;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.9rem}
      .gk-prov button.sel{border-color:#1d4e8a;background:#eef3f8;font-weight:600}
      #gk-key{width:100%;padding:.6rem .75rem;border:1px solid #e5e3da;border-radius:8px;font-family:inherit;font-size:.95rem}
      #gk-msg{font-size:.85rem;margin:.6rem 0 0;min-height:1.1em}#gk-msg.err{color:#8a2c2c}#gk-msg.ok{color:#2c6b35}
      .gk-row{display:flex;gap:.5rem;align-items:center;margin-top:1rem}
      .gk-row .gk-save{background:#1d4e8a;color:#fff;border:none;padding:.6rem 1.1rem;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:500}
      .gk-row .gk-save:disabled{background:#9a9a93}
      .gk-row .gk-ghost{background:none;border:1px solid #e5e3da;color:#1c1c1a;padding:.55rem .9rem;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.88rem}
      .gk-row .gk-spacer{flex:1}.gk-link{font-size:.8rem;color:#1d4e8a}`;
    document.head.appendChild(style);
    const ov = document.createElement('div');
    ov.id = 'gk-ov';
    ov.innerHTML = `<div id="gk-card"><h2 id="gk-title">Add your AI key</h2>
      <p id="gk-sub"></p>
      <div id="gk-body"><div class="gk-prov" id="gk-prov"></div>
        <input type="text" id="gk-key" placeholder="Paste your key" autocomplete="off" />
        <p class="gk-link" id="gk-getlink"></p><p id="gk-msg"></p></div>
      <div class="gk-row" id="gk-actions"></div></div>`;
    document.body.appendChild(ov);
    const el = (id) => ov.querySelector('#' + id);
    const setMsg = (t, kind) => { const m = el('gk-msg'); m.textContent = t || ''; m.className = kind || ''; };
    const renderProviders = () => {
      el('gk-prov').innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<button data-p="${k}" class="${k === picked ? 'sel' : ''}">${v.label}</button>`).join('');
      el('gk-prov').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { picked = b.dataset.p; renderProviders(); }));
      el('gk-key').placeholder = 'Paste your key (' + PROVIDERS[picked].hint + ')';
      el('gk-getlink').innerHTML = `Don't have one? <a href="${PROVIDERS[picked].link}" target="_blank" rel="noopener">Get a ${PROVIDERS[picked].label} key</a>`;
    };
    async function save(required) {
      const key = el('gk-key').value.trim();
      if (!key) { setMsg('Paste your key first.', 'err'); return; }
      const btn = el('gk-savebtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Checking…';
      setMsg('Checking the key with ' + PROVIDERS[picked].label + '…', '');
      try {
        const r = await postJson('api/setup', { provider: picked, apiKey: key });
        if (!r.ok) { setMsg(r.message || 'Could not save the key.', 'err'); return; }
        setMsg(r.warning || (r.verified ? '✓ Key works. Saved.' : '✓ Saved.'), 'ok');
        if (typeof opts.onConfigured === 'function') opts.onConfigured();
        setTimeout(() => { if (required) location.reload(); else close(); }, r.warning ? 1400 : 750);
      } catch (e) { setMsg('Network error: ' + e.message, 'err'); }
      finally { btn.disabled = false; btn.textContent = old; }
    }
    async function removeKey() {
      if (!confirm('Remove the saved key from this computer? You can paste a new one any time.')) return;
      await postJson('api/setup', { provider: null, apiKey: null }); location.reload();
    }
    function close() { ov.classList.remove('open'); }
    async function open(mode) {
      const status = await fetchJson('api/setup').catch(() => ({}));
      el('gk-key').value = ''; setMsg('', '');
      if (status.serverManaged) {
        el('gk-title').textContent = 'AI key';
        el('gk-sub').textContent = 'When you use this online, the key is managed by Grounded — there’s nothing to set here.';
        el('gk-body').style.display = 'none';
        el('gk-actions').innerHTML = '<div class="gk-spacer"></div><button class="gk-ghost" id="gk-close">Close</button>';
        el('gk-close').addEventListener('click', close);
      } else {
        el('gk-body').style.display = 'block';
        const configured = !!status.configured;
        picked = status.activeProvider === 'openai' ? 'openai' : 'anthropic';
        renderProviders();
        el('gk-title').textContent = configured ? 'Change your AI key' : 'Add your AI key';
        el('gk-sub').textContent = configured
          ? `A ${status.activeProvider === 'openai' ? 'OpenAI' : 'Anthropic'} key is set. Paste a new one to replace it — saved on this computer only.`
          : 'Paste your key below — saved on this computer only, never uploaded. Nothing to edit by hand.';
        const required = mode === 'required';
        el('gk-actions').innerHTML = '<button class="gk-save" id="gk-savebtn">Test &amp; save</button>'
          + (configured ? '<button class="gk-ghost" id="gk-remove">Remove key</button>' : '')
          + '<div class="gk-spacer"></div>' + (required ? '' : '<button class="gk-ghost" id="gk-close">Close</button>');
        el('gk-savebtn').addEventListener('click', () => save(required));
        el('gk-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(required); });
        if (el('gk-remove')) el('gk-remove').addEventListener('click', removeKey);
        if (el('gk-close')) el('gk-close').addEventListener('click', close);
      }
      ov.classList.add('open');
      setTimeout(() => el('gk-key') && el('gk-key').focus(), 50);
    }
    const trigger = document.getElementById('key-settings') || document.getElementById('change-key-link');
    if (trigger) trigger.addEventListener('click', (e) => { e.preventDefault(); open('settings'); });
    fetchJson('api/setup').then((s) => { if (s && !s.configured && !s.serverManaged) open('required'); }).catch(() => {});
  }

  boot();
})();
