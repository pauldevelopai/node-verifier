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

  // ─── Boot ─────────────────────────────────────────────────────────

  async function boot() {
    let status = { configured: false };
    try {
      status = await fetchJson('api/setup');
    } catch {
      // If setup endpoint isn't reachable, fall through to welcome.
    }
    if (!status.configured) {
      document.getElementById('welcome-screen').style.display = 'block';
      wireWelcome();
    } else {
      document.getElementById('app').style.display = 'block';
      wireApp();
    }
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

    // Change-key link
    $('#change-key-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (confirm('Re-enter your API key? Your existing data and history are kept.')) {
        await postJson('api/setup', { provider: null, apiKey: null });
        location.reload();
      }
    });

    // Verify mode actions
    $('#verify-btn').addEventListener('click', verifyClaim);
    $('#add-example-btn').addEventListener('click', addExample);

    // Listen mode actions
    $('#add-page-btn').addEventListener('click', addWatchlistPage);
    $('#analyze-btn').addEventListener('click', analyzePost);
    $('#library-refresh').addEventListener('click', loadLibrary);
    $('#library-compare-btn').addEventListener('click', runComparison);
    $('#generate-brief-btn').addEventListener('click', generateBrief);
  }

  function activateTab(btn) {
    $$('nav button.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.panel').forEach((p) =>
      p.classList.toggle('active', p.id === 'panel-' + btn.dataset.panel)
    );

    const panel = btn.dataset.panel;
    if (panel === 'corpus') loadCorpus();
    if (panel === 'history') loadHistory();
    if (panel === 'watchlist') loadWatchlist();
    if (panel === 'library') loadLibrary();
    if (panel === 'brief') loadBriefs();
    if (panel === 'activity') loadActivity();
  }

  // ─── Verify mode: claim verification ──────────────────────────────

  async function verifyClaim() {
    const claimText = $('#claim-text').value.trim();
    const file = $('#claim-image').files[0];
    const sourceUrl = $('#claim-url').value.trim();
    const status = $('#verify-status');
    const reportArea = $('#report-area');

    if (!claimText && !file) {
      status.textContent = 'Provide claim text, an image, or both.';
      status.style.color = 'var(--tier-false)';
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

      const result = await postJson('api/brief', {
        claimText: claimText || null,
        imageBase64,
        imageMimeType,
        sourceUrl: sourceUrl || null,
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

      status.textContent = `Done. Corpus size at time of check: ${result.corpus_size} example(s).`;
      renderReport(result.report);
    } catch (e) {
      status.textContent = 'Network error: ' + e.message;
      status.style.color = 'var(--tier-false)';
    } finally {
      $('#verify-btn').disabled = false;
    }
  }

  function renderReport(report) {
    const area = $('#report-area');
    const tierClass = 'tier-' + (report.tier || '').replace(/ /g, '.');
    const matching = (report.matching_examples || [])
      .map((m) => `<li><code>${escapeHtml(m.filename)}</code> — ${escapeHtml(m.why_it_matches)}</li>`).join('');
    const reasoning = (report.reasoning_chain || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const checks = (report.further_checks || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    area.innerHTML = `
      <div class="section">
        <span class="tier-badge ${tierClass}">${escapeHtml(report.tier || '')}</span>
        <span style="margin-left:0.6rem;color:var(--muted);font-size:0.9rem">${escapeHtml(report.tier_reason || '')}</span>
      </div>
      <div class="section">
        <h3>Claim restated</h3>
        <div>${escapeHtml(report.claim_restated || '')}</div>
      </div>
      ${matching ? `<div class="section"><h3>Matching past examples</h3><ul>${matching}</ul></div>` : ''}
      ${reasoning ? `<div class="section"><h3>Reasoning</h3><ol>${reasoning}</ol></div>` : ''}
      ${checks ? `<div class="section"><h3>Further checks</h3><ul>${checks}</ul></div>` : ''}
      ${report.draft_response ? `<div class="section"><h3>Suggested draft response</h3><div class="draft">${escapeHtml(report.draft_response)}</div></div>` : ''}
    `;
    area.style.display = 'block';
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

  async function loadHistory() {
    const status = $('#history-status');
    const metrics = $('#history-metrics');
    const list = $('#history-list');
    status.textContent = 'Loading…';
    metrics.innerHTML = '';
    list.innerHTML = '';

    const [report, quality] = await Promise.all([fetchJson('api/report'), fetchJson('api/quality')]);

    metrics.innerHTML = `
      <div class="metric"><div class="label">Total checked</div><div class="value">${quality.total_claims_checked}</div></div>
      <div class="metric"><div class="label">Verified</div><div class="value">${quality.by_tier.VERIFIED}</div></div>
      <div class="metric"><div class="label">Contested</div><div class="value">${quality.by_tier.CONTESTED}</div></div>
      <div class="metric"><div class="label">Likely false</div><div class="value">${quality.by_tier['LIKELY FALSE']}</div></div>
    `;

    if (report.recent.length === 0) {
      status.innerHTML = '<span class="empty">No claims checked yet.</span>';
      return;
    }
    status.textContent = `Showing the ${report.recent.length} most recent checks.`;
    report.recent.forEach((c) => {
      const tier = c.report?.tier || '—';
      const restated = c.report?.claim_restated || c.claim_text || '(image only)';
      const div = document.createElement('div');
      div.className = 'recent-claim';
      div.innerHTML = `
        <div class="when">${new Date(c.timestamp).toLocaleString()}</div>
        <div class="claim">${escapeHtml(restated)}</div>
        <span class="tier-badge tier-${tier.replace(/ /g, '.')}">${escapeHtml(tier)}</span>
      `;
      list.appendChild(div);
    });
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
    const status = $('#analyze-status');
    const area = $('#profile-area');

    if (!postText) {
      status.textContent = 'Paste the post text first.';
      status.style.color = 'var(--tier-false)';
      return;
    }

    $('#analyze-btn').disabled = true;
    status.style.color = 'var(--muted)';
    status.textContent = 'Analysing… this usually takes 15–30 seconds.';
    area.style.display = 'none';

    try {
      const result = await postJson('api/listener/analyze', { postText, pageUrl, postUrl, journalistNotes });
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
      renderRiskProfile(result.profile);
    } catch (e) {
      status.textContent = 'Network error: ' + e.message;
      status.style.color = 'var(--tier-false)';
    } finally {
      $('#analyze-btn').disabled = false;
    }
  }

  function renderRiskProfile(profile) {
    const area = $('#profile-area');
    const confClass = 'conf-' + (profile.confidence || '').replace(/ /g, '.');
    const flags = (profile.flags || []).map((f) => `
      <div class="flag-row">
        <div class="cat">${escapeHtml(f.category)} · ${escapeHtml(f.weight || '')}</div>
        <div>${escapeHtml(f.observation)}</div>
      </div>
    `).join('');
    const why = (profile.why_chain || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    const checks = (profile.further_checks || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');

    area.innerHTML = `
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
    area.style.display = 'block';
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
    renderComparison(result.comparison);
  }

  function renderComparison(c) {
    const area = $('#compare-area');
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

    area.innerHTML = `
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
    area.style.display = 'block';
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

  // ─── Shared: activity ────────────────────────────────────────────

  async function loadActivity() {
    const list = $('#activity-list');
    list.innerHTML = '<span class="status-line">Loading…</span>';
    const entries = await fetchJson('api/activity');
    if (!Array.isArray(entries) || entries.length === 0) {
      list.innerHTML = '<span class="empty">No activity recorded yet.</span>';
      return;
    }
    list.innerHTML = '';
    entries.slice(-100).reverse().forEach((e) => {
      const div = document.createElement('div');
      div.className = 'activity-row';
      const when = e.timestamp ? new Date(e.timestamp).toLocaleString() : '—';
      const extras = Object.entries(e)
        .filter(([k]) => !['timestamp', 'op'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' · ');
      div.innerHTML = `<span class="when">${when}</span> — <strong>${escapeHtml(e.op || 'event')}</strong>${extras ? ' · ' + escapeHtml(extras) : ''}`;
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

  boot();
})();
