function typeBadgeFor(a) {
  if (a.type === 'whiteboard') {
    const wf = a.whiteboardFormat || 'html';
    const label = wf === 'svg' ? 'SVG' : wf === 'mermaid' ? 'Mermaid' : 'HTML fragment';
    const cls = wf === 'svg' ? 'wb-svg' : wf === 'mermaid' ? 'wb-mermaid' : 'wb-html';
    return { label, cls, kind: 'whiteboard' };
  }
  const fmt = (a.format || '').toLowerCase();
  if (fmt === 'jsx') return { label: 'JSX', cls: 'art-jsx', kind: 'artifact' };
  if (fmt === 'html') return { label: 'HTML', cls: 'art-html', kind: 'artifact' };
  return { label: fmt || 'unknown', cls: 'art-other', kind: 'artifact' };
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = (now - d) / 86400000;
  if (diffDays < 1) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function galleryHtml(artifacts, baseUrl) {
  const counts = { all: artifacts.length, artifact: 0, whiteboard: 0, jsx: 0, svg: 0, mermaid: 0 };
  for (const a of artifacts) {
    const b = typeBadgeFor(a);
    counts[b.kind] = (counts[b.kind] || 0) + 1;
    if (a.type !== 'whiteboard' && (a.format||'').toLowerCase() === 'jsx') counts.jsx++;
    if (a.whiteboardFormat === 'svg') counts.svg++;
    if (a.whiteboardFormat === 'mermaid') counts.mermaid++;
  }

  const items = artifacts.map(a => {
    const badge = typeBadgeFor(a);
    const filterTag = a.type === 'whiteboard' ? `wb-${a.whiteboardFormat || 'html'}` : `art-${(a.format||'unknown').toLowerCase()}`;
    return `
    <li class="art-item" data-slug="${esc(a.slug)}" data-title="${esc(a.title)}" data-kind="${badge.kind}" data-filter="${filterTag}" data-url="${a.url}" data-badge="${badge.label}" data-badge-cls="${badge.cls}">
      <input type="checkbox" class="art-cb" value="${esc(a.slug)}" onclick="event.stopPropagation(); updateBulkUI();" />
      <div class="art-item-body" onclick="openArtifact('${esc(a.slug)}')">
        <div class="art-item-row">
          <span class="art-item-title">${esc(a.title)}</span>
          <span class="type-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="art-item-meta">
          <code>${esc(a.slug)}</code>
          <span class="meta-sep">·</span>
          <span>${a.size_kb} KB</span>
          <span class="meta-sep">·</span>
          <span>${shortDate(a.created)}</span>
        </div>
      </div>
      <button class="art-item-action" title="Open in new tab" onclick="event.stopPropagation(); window.open('${a.url}', '_blank')">↗</button>
    </li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Artifact Gallery</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e2e8f0; overflow: hidden; }

    /* Layout */
    .app { display: grid; grid-template-rows: 56px 1fr; height: 100vh; }
    header.topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: #0f172a; border-bottom: 1px solid #1e293b; gap: 16px; }
    header.topbar h1 { font-size: 15px; font-weight: 600; color: #e2e8f0; display: flex; align-items: center; gap: 12px; }
    header.topbar h1 .count { font-size: 12px; color: #64748b; font-weight: 400; padding: 3px 8px; background: #1e293b; border-radius: 4px; }
    .bulk-actions { display: flex; gap: 8px; align-items: center; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
    .bulk-actions.visible { opacity: 1; pointer-events: auto; }
    .bulk-actions .selected-count { color: #94a3b8; font-size: 12px; }

    .split { display: grid; grid-template-columns: 380px 1fr; min-height: 0; }
    .sidebar { background: #0a0f1a; border-right: 1px solid #1e293b; display: flex; flex-direction: column; min-height: 0; }
    .preview-pane { display: flex; flex-direction: column; min-height: 0; background: #0a0a0a; }

    /* Sidebar */
    .sidebar-toolbar { padding: 10px 12px; border-bottom: 1px solid #1e293b; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
    .search-box { width: 100%; padding: 7px 10px; background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; color: #e2e8f0; font-size: 13px; outline: none; transition: border-color 0.15s; }
    .search-box:focus { border-color: #3b82f6; }
    .search-box::placeholder { color: #475569; }

    .filter-bar { display: flex; gap: 4px; flex-wrap: wrap; }
    .filter-chip { padding: 3px 9px; background: #0f172a; border: 1px solid #1e293b; color: #94a3b8; border-radius: 4px; font-size: 11px; cursor: pointer; transition: all 0.1s; white-space: nowrap; }
    .filter-chip:hover { border-color: #475569; color: #cbd5e1; }
    .filter-chip.active { border-color: #3b82f6; color: #60a5fa; background: #0c1a2e; }
    .filter-chip .chip-count { color: #475569; margin-left: 4px; font-size: 10px; }
    .filter-chip.active .chip-count { color: #60a5fa; }

    .art-list { list-style: none; flex: 1; overflow-y: auto; padding: 6px 0; }
    .art-list::-webkit-scrollbar { width: 8px; }
    .art-list::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
    .art-list::-webkit-scrollbar-thumb:hover { background: #334155; }

    .art-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; cursor: pointer; border-left: 3px solid transparent; transition: background 0.1s; }
    .art-item:hover { background: #0f172a; }
    .art-item.active { background: #0c1a2e; border-left-color: #3b82f6; }
    .art-item.selected { background: #0f1f33; }
    .art-cb { margin-top: 3px; cursor: pointer; accent-color: #3b82f6; flex-shrink: 0; }
    .art-item-body { flex: 1; min-width: 0; }
    .art-item-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
    .art-item-title { font-size: 13px; color: #e2e8f0; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .art-item.active .art-item-title { color: #fff; }
    .art-item-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; }
    .art-item-meta code { background: transparent; color: #475569; padding: 0; font-size: 10.5px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .art-item-meta .meta-sep { color: #334155; }
    .art-item-action { opacity: 0; background: transparent; border: 1px solid #334155; color: #64748b; border-radius: 4px; padding: 2px 7px; cursor: pointer; font-size: 12px; transition: all 0.1s; flex-shrink: 0; align-self: center; }
    .art-item:hover .art-item-action { opacity: 1; }
    .art-item-action:hover { color: #cbd5e1; border-color: #475569; }

    .empty-list { padding: 24px 16px; text-align: center; color: #475569; font-size: 13px; }

    /* Type badges */
    .type-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; flex-shrink: 0; }
    .art-jsx     { background: #1e3a5f; color: #93c5fd; }
    .art-html    { background: #3a3a1e; color: #fde68a; }
    .art-other   { background: #334155; color: #cbd5e1; }
    .wb-svg      { background: #1e3a2f; color: #86efac; }
    .wb-mermaid  { background: #3a1e3a; color: #f0abfc; }
    .wb-html     { background: #3a2a1e; color: #fdba74; }

    /* Tab bar */
    .tab-bar { display: flex; align-items: stretch; background: #0f172a; border-bottom: 1px solid #1e293b; min-height: 38px; overflow-x: auto; flex-shrink: 0; }
    .tab-bar::-webkit-scrollbar { height: 4px; }
    .tab-bar::-webkit-scrollbar-thumb { background: #1e293b; }
    .tab { display: flex; align-items: center; gap: 8px; padding: 0 14px 0 14px; border-right: 1px solid #1e293b; cursor: pointer; max-width: 240px; min-width: 120px; transition: background 0.1s; position: relative; }
    .tab:hover { background: #0c1a2e; }
    .tab.active { background: #0a0a0a; }
    .tab.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #3b82f6; }
    .tab-title { color: #94a3b8; font-size: 12px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab.active .tab-title { color: #e2e8f0; }
    .tab-close { background: transparent; border: none; color: #475569; font-size: 14px; cursor: pointer; padding: 2px 4px; border-radius: 3px; line-height: 1; transition: all 0.1s; }
    .tab-close:hover { background: #1e293b; color: #e2e8f0; }
    .tab-actions { display: flex; align-items: center; gap: 4px; padding: 0 12px; margin-left: auto; flex-shrink: 0; border-left: 1px solid #1e293b; }
    .tab-action-btn { background: transparent; border: 1px solid #1e293b; color: #64748b; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: all 0.1s; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
    .tab-action-btn:hover { border-color: #475569; color: #cbd5e1; }
    .tab-action-btn.danger:hover { border-color: #7f1d1d; color: #fca5a5; }

    /* Iframe / empty */
    .preview-frame { flex: 1; border: none; background: #0a0a0a; }
    .empty-preview { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; color: #475569; padding: 20px; text-align: center; }
    .empty-preview .hint-icon { font-size: 32px; opacity: 0.5; }
    .empty-preview h2 { font-size: 16px; color: #94a3b8; font-weight: 500; }
    .empty-preview p { font-size: 13px; line-height: 1.5; max-width: 320px; }
    .empty-preview kbd { background: #1e293b; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #cbd5e1; font-family: ui-monospace, monospace; }

    /* Buttons */
    .btn { padding: 5px 11px; border-radius: 4px; font-size: 12px; cursor: pointer; border: 1px solid transparent; text-decoration: none; line-height: 1.4; transition: all 0.1s; display: inline-flex; align-items: center; gap: 4px; }
    .btn-primary { background: #1e40af; color: #dbeafe; border-color: #1e40af; }
    .btn-primary:hover { background: #2563eb; border-color: #2563eb; }
    .btn-secondary { background: transparent; color: #94a3b8; border-color: #334155; }
    .btn-secondary:hover { background: #1e293b; color: #cbd5e1; }
    .btn-danger { background: transparent; color: #fca5a5; border-color: #7f1d1d; }
    .btn-danger:hover { background: #7f1d1d; color: #fee2e2; }

    .toast { position: fixed; bottom: 16px; right: 16px; background: #065f46; color: #d1fae5; padding: 10px 16px; border-radius: 6px; display: none; font-size: 13px; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .toast.error { background: #7f1d1d; color: #fee2e2; }

    /* Sidebar collapse */
    .sidebar-toggle { display: none; }
    @media (max-width: 768px) {
      .split { grid-template-columns: 1fr; }
      .sidebar { position: absolute; top: 56px; left: 0; bottom: 0; width: 100%; max-width: 380px; z-index: 50; transform: translateX(-100%); transition: transform 0.2s; }
      .sidebar.open { transform: translateX(0); }
      .sidebar-toggle { display: inline-flex; }
    }

    /* Empty state list */
    .empty-gallery { padding: 60px 20px; text-align: center; color: #64748b; }
    .empty-gallery h2 { font-size: 18px; color: #94a3b8; margin-bottom: 8px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <h1>
        <button class="btn btn-secondary sidebar-toggle" onclick="toggleSidebar()">☰</button>
        Artifact Gallery
        <span class="count">${artifacts.length} item${artifacts.length !== 1 ? 's' : ''}</span>
      </h1>
      <div class="bulk-actions" id="bulkActions">
        <span class="selected-count" id="selectedCount">0 selected</span>
        <button class="btn btn-danger" onclick="deleteSelected()">Delete selected</button>
        <button class="btn btn-secondary" onclick="clearSelection()">Clear</button>
      </div>
    </header>

    <div class="split">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-toolbar">
          <input type="text" class="search-box" id="searchBox" placeholder="Search by title or slug…" oninput="applyFilters()" />
          <div class="filter-bar">
            <button class="filter-chip active" data-filter="*" onclick="setFilter(this)">All<span class="chip-count">${counts.all}</span></button>
            <button class="filter-chip" data-filter="kind:artifact" onclick="setFilter(this)">Artifacts<span class="chip-count">${counts.artifact}</span></button>
            <button class="filter-chip" data-filter="kind:whiteboard" onclick="setFilter(this)">Whiteboards<span class="chip-count">${counts.whiteboard}</span></button>
            <button class="filter-chip" data-filter="f:wb-svg" onclick="setFilter(this)">SVG<span class="chip-count">${counts.svg}</span></button>
            <button class="filter-chip" data-filter="f:wb-mermaid" onclick="setFilter(this)">Mermaid<span class="chip-count">${counts.mermaid}</span></button>
          </div>
        </div>
        ${artifacts.length === 0 ? '<div class="empty-list">No artifacts yet.<br>Publish via <code>publish_artifact</code> or <code>write_whiteboard</code>.</div>' : `<ul class="art-list" id="artList">${items}</ul>`}
      </aside>

      <section class="preview-pane">
        <div class="tab-bar" id="tabBar">
          <div class="tab-actions" id="tabActions" style="display:none">
            <a class="tab-action-btn" id="tabOpenNew" target="_blank" rel="noopener">↗ Open in new tab</a>
            <a class="tab-action-btn" id="tabDownload" download>⬇ Download</a>
            <button class="tab-action-btn danger" onclick="deleteCurrentTab()">Delete</button>
          </div>
        </div>
        <div class="empty-preview" id="emptyPreview">
          <div class="hint-icon">←</div>
          <h2>Select an artifact to preview</h2>
          <p>Click any item in the sidebar to open it as a tab here. Open multiple tabs to flip between artifacts without losing the index.</p>
          <p style="opacity:0.6">Tip: <kbd>⇧</kbd> + click to open in a new browser tab · the small <kbd>↗</kbd> icon does the same.</p>
        </div>
        <iframe class="preview-frame" id="previewFrame" style="display:none"></iframe>
      </section>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    // ─── Tab management ───
    const openTabs = new Map(); // slug -> { slug, title, url }
    let activeSlug = null;

    function findItem(slug) {
      // Plain iteration avoids querySelector escaping for slugs with special chars
      const items = document.querySelectorAll('.art-item');
      for (const it of items) if (it.dataset.slug === slug) return it;
      return null;
    }

    function openArtifact(slug) {
      const item = findItem(slug);
      if (!item) { console.warn('openArtifact: no item for slug', slug); return; }
      const title = item.dataset.title;
      const url = item.dataset.url;
      if (!openTabs.has(slug)) {
        openTabs.set(slug, { slug, title, url });
        renderTabs();
      }
      setActive(slug);
    }

    function setActive(slug) {
      activeSlug = slug;
      const tab = openTabs.get(slug);
      const frame = document.getElementById('previewFrame');
      const empty = document.getElementById('emptyPreview');
      const actions = document.getElementById('tabActions');
      if (!tab) {
        frame.style.display = 'none';
        empty.style.display = 'flex';
        actions.style.display = 'none';
        return;
      }
      empty.style.display = 'none';
      frame.style.display = 'block';
      // Only update src if different to avoid reload churn
      if (frame.src !== tab.url) frame.src = tab.url;
      document.getElementById('tabOpenNew').href = tab.url;
      document.getElementById('tabDownload').href = tab.url;
      document.getElementById('tabDownload').download = tab.slug + '.html';
      actions.style.display = 'flex';
      renderTabs();
      highlightActiveItem();
    }

    function closeTab(slug, ev) {
      if (ev) ev.stopPropagation();
      const slugs = Array.from(openTabs.keys());
      const idx = slugs.indexOf(slug);
      openTabs.delete(slug);
      if (activeSlug === slug) {
        const next = slugs[idx + 1] || slugs[idx - 1] || null;
        if (next) setActive(next);
        else { activeSlug = null; setActive(null); }
      }
      renderTabs();
    }

    function renderTabs() {
      const bar = document.getElementById('tabBar');
      const tabActions = document.getElementById('tabActions');
      // Remove existing tab nodes (keep tabActions)
      Array.from(bar.querySelectorAll('.tab')).forEach(el => el.remove());
      // Insert tabs before tabActions
      for (const t of openTabs.values()) {
        const el = document.createElement('div');
        el.className = 'tab' + (t.slug === activeSlug ? ' active' : '');
        el.title = t.title;
        el.onclick = () => setActive(t.slug);
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = t.title;
        const close = document.createElement('button');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = 'Close tab';
        close.onclick = (ev) => closeTab(t.slug, ev);
        el.appendChild(title);
        el.appendChild(close);
        bar.insertBefore(el, tabActions);
      }
    }

    function highlightActiveItem() {
      document.querySelectorAll('.art-item').forEach(el => {
        el.classList.toggle('active', el.dataset.slug === activeSlug);
      });
    }

    // ─── Filters / search ───
    let currentFilter = '*';

    function setFilter(btn) {
      currentFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c === btn));
      applyFilters();
    }

    function applyFilters() {
      const q = (document.getElementById('searchBox').value || '').toLowerCase().trim();
      let visible = 0;
      document.querySelectorAll('.art-item').forEach(item => {
        let show = true;
        if (currentFilter !== '*') {
          if (currentFilter.startsWith('kind:')) {
            show = item.dataset.kind === currentFilter.slice(5);
          } else if (currentFilter.startsWith('f:')) {
            show = item.dataset.filter === currentFilter.slice(2);
          }
        }
        if (show && q) {
          const hay = (item.dataset.title + ' ' + item.dataset.slug).toLowerCase();
          show = hay.includes(q);
        }
        item.style.display = show ? '' : 'none';
        if (show) visible++;
      });
    }

    // ─── Multi-select ───
    function getSelectedSlugs() {
      return Array.from(document.querySelectorAll('.art-cb:checked')).map(cb => cb.value);
    }

    function updateBulkUI() {
      const selected = getSelectedSlugs();
      const bar = document.getElementById('bulkActions');
      bar.classList.toggle('visible', selected.length > 0);
      document.getElementById('selectedCount').textContent = selected.length + ' selected';
      document.querySelectorAll('.art-item').forEach(it => {
        const cb = it.querySelector('.art-cb');
        it.classList.toggle('selected', cb && cb.checked);
      });
    }

    function clearSelection() {
      document.querySelectorAll('.art-cb').forEach(cb => { cb.checked = false; });
      updateBulkUI();
    }

    async function deleteSelected() {
      const slugs = getSelectedSlugs();
      if (slugs.length === 0) return;
      if (!confirm('Delete ' + slugs.length + ' artifact(s)?')) return;
      try {
        const res = await fetch('/api/artifacts/batch', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs }),
        });
        const data = await res.json();
        if (res.ok) {
          for (const slug of slugs) openTabs.delete(slug);
          if (activeSlug && slugs.includes(activeSlug)) {
            activeSlug = openTabs.size > 0 ? openTabs.keys().next().value : null;
            setActive(activeSlug);
          }
          showToast('Deleted ' + data.deleted + ' artifact(s)');
          setTimeout(() => location.reload(), 600);
        } else {
          showToast('Error: ' + (data.error || 'Unknown'), true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      }
    }

    async function deleteCurrentTab() {
      if (!activeSlug) return;
      const tab = openTabs.get(activeSlug);
      if (!confirm('Delete "' + (tab?.title || activeSlug) + '"?')) return;
      try {
        const res = await fetch('/api/artifacts/' + activeSlug, { method: 'DELETE' });
        if (res.ok) {
          showToast('Deleted: ' + activeSlug);
          setTimeout(() => location.reload(), 600);
        } else {
          const err = await res.json();
          showToast('Error: ' + (err.error || 'Unknown'), true);
        }
      } catch (e) {
        showToast('Error: ' + e.message, true);
      }
    }

    function showToast(msg, isError) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.toggle('error', !!isError);
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
    }

    // (cssEscape removed — findItem iterates instead)

    // Keyboard shortcuts
    document.addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT') return;
      if ((ev.key === 'w' && (ev.metaKey || ev.ctrlKey)) || ev.key === 'Escape') {
        if (activeSlug) { closeTab(activeSlug); ev.preventDefault(); }
      }
    });
  </script>
</body>
</html>`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
