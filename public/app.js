// Capital FM Claim Check — dashboard JS
//
// Plain vanilla, no framework. Hits the standard /api/* routes
// provided by the runtime. Follows the same pattern as the
// node-makanday-analytics dashboard.

(function () {
  const $ = (sel) => document.querySelector(sel);

  let pickedProvider = null;

  // ─── Boot ─────────────────────────────────────────────────────────

  async function boot() {
    const status = await fetchJson('/api/setup');
    if (!status.configured) {
      $('#welcome-screen').style.display = 'block';
      wireWelcome();
    } else {
      $('#app').style.display = 'block';
      wireApp();
      loadInitialData();
    }
  }

  // ─── Welcome screen ───────────────────────────────────────────────

  function wireWelcome() {
    document.querySelectorAll('.provider-row button').forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedProvider = btn.dataset.provider;
        document.querySelectorAll('.provider-row button').forEach((b) =>
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

      try {
        const result = await postJson('/api/setup', { provider: pickedProvider, apiKey: key });
        if (!result.ok) { err.textContent = result.message || 'Could not save key.'; err.style.display = 'block'; return; }
        location.reload();
      } catch (e) {
        err.textContent = 'Network error. Is the server still running?';
        err.style.display = 'block';
      }
    });
  }

  // ─── Main app ─────────────────────────────────────────────────────

  function wireApp() {
    document.querySelectorAll('nav button.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('nav button.tab').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.panel').forEach((p) =>
          p.classList.toggle('active', p.id === 'panel-' + btn.dataset.panel)
        );
        if (btn.dataset.panel === 'corpus') loadCorpus();
        if (btn.dataset.panel === 'history') loadHistory();
        if (btn.dataset.panel === 'activity') loadActivity();
      });
    });

    $('#change-key-link').addEventListener('click', async (e) => {
      e.preventDefault();
      if (confirm('Re-enter your API key? Your existing data and history are kept.')) {
        await postJson('/api/setup', { provider: null, apiKey: null });
        location.reload();
      }
    });

    $('#verify-btn').addEventListener('click', verifyClaim);
    $('#add-example-btn').addEventListener('click', addExample);
  }

  async function loadInitialData() {
    // Nothing to load eagerly — each tab loads on demand.
  }

  // ─── Verifying a claim ────────────────────────────────────────────

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

      const result = await postJson('/api/brief', {
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

  // ─── Corpus ──────────────────────────────────────────────────────

  async function loadCorpus() {
    const status = $('#corpus-status');
    const list = $('#corpus-list');
    status.textContent = 'Loading…';
    list.innerHTML = '';
    const result = await fetchJson('/api/sources');
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
    const result = await postJson('/api/ingest', { filename: finalName, content });
    if (result.ok) {
      $('#example-filename').value = '';
      $('#example-content').value = '';
      loadCorpus();
    } else {
      alert('Could not save: ' + (result.error || 'unknown error'));
    }
  }

  // ─── History ──────────────────────────────────────────────────────

  async function loadHistory() {
    const status = $('#history-status');
    const metrics = $('#history-metrics');
    const list = $('#history-list');
    status.textContent = 'Loading…';
    metrics.innerHTML = '';
    list.innerHTML = '';

    const [report, quality] = await Promise.all([fetchJson('/api/report'), fetchJson('/api/quality')]);

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

  // ─── Activity ─────────────────────────────────────────────────────

  async function loadActivity() {
    const list = $('#activity-list');
    list.innerHTML = '<span class="status-line">Loading…</span>';
    const entries = await fetchJson('/api/activity');
    if (!Array.isArray(entries) || entries.length === 0) {
      list.innerHTML = '<span class="empty">No activity recorded yet.</span>';
      return;
    }
    list.innerHTML = '';
    entries.slice(-50).reverse().forEach((e) => {
      const div = document.createElement('div');
      div.className = 'activity-row';
      div.innerHTML = `<span class="when">${new Date(e.timestamp || Date.now()).toLocaleString()}</span> — ${escapeHtml(e.op || 'event')} ${e.note ? '· ' + escapeHtml(e.note) : ''}`;
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
        // strip data:image/...;base64, prefix
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  boot();
})();
