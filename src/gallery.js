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
  <script>
    // FOUC-prevention: set theme attribute before any CSS reads vars.
    (function() {
      try {
        var t = localStorage.getItem('gal-theme');
        if (!t) t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', t);
      } catch(e) { document.documentElement.setAttribute('data-theme', 'dark'); }
    })();
  </script>
  <style>
    /* Theme tokens — dark default, light via [data-theme="light"] */
    :root {
      --bg: #0a0a0a; --bg-1: #0a0f1a; --bg-2: #0f172a; --bg-3: #0c1a2e;
      --bg-hover: #1e293b; --bg-card: #1e293b;
      --text: #e2e8f0; --text-strong: #ffffff; --text-muted: #94a3b8;
      --text-faint: #64748b; --text-dim: #475569; --text-vdim: #334155;
      --border: #1e293b; --border-strong: #334155; --border-strongest: #475569;
      --accent: #3b82f6; --accent-text: #60a5fa;
      --accent-bg: #1e40af; --accent-bg-hover: #2563eb; --accent-bg-soft: #0c1a2e;
      --selected-bg: #0f1f33;
      --danger-bg: transparent; --danger-bg-hover: #7f1d1d;
      --danger-border: #7f1d1d; --danger-text: #fca5a5; --danger-text-strong: #fee2e2;
      --toast-bg: #065f46; --toast-fg: #d1fae5;
      --toast-err-bg: #7f1d1d; --toast-err-fg: #fee2e2;
      --shadow: 0 4px 12px rgba(0,0,0,0.3);
      --scroll-thumb: #1e293b; --scroll-thumb-hover: #334155;
      /* type badges */
      --b-jsx-bg: #1e3a5f;     --b-jsx-fg: #93c5fd;
      --b-html-bg: #3a3a1e;    --b-html-fg: #fde68a;
      --b-other-bg: #334155;   --b-other-fg: #cbd5e1;
      --b-svg-bg: #1e3a2f;     --b-svg-fg: #86efac;
      --b-mermaid-bg: #3a1e3a; --b-mermaid-fg: #f0abfc;
      --b-whtml-bg: #3a2a1e;   --b-whtml-fg: #fdba74;
      --iframe-bg: #0a0a0a;
    }
    [data-theme="light"] {
      --bg: #ffffff; --bg-1: #f8fafc; --bg-2: #f1f5f9; --bg-3: #eff6ff;
      --bg-hover: #f1f5f9; --bg-card: #f8fafc;
      --text: #0f172a; --text-strong: #020617; --text-muted: #475569;
      --text-faint: #64748b; --text-dim: #94a3b8; --text-vdim: #cbd5e1;
      --border: #e2e8f0; --border-strong: #cbd5e1; --border-strongest: #94a3b8;
      --accent: #2563eb; --accent-text: #1d4ed8;
      --accent-bg: #2563eb; --accent-bg-hover: #1d4ed8; --accent-bg-soft: #dbeafe;
      --selected-bg: #dbeafe;
      --danger-bg: transparent; --danger-bg-hover: #fee2e2;
      --danger-border: #fca5a5; --danger-text: #b91c1c; --danger-text-strong: #7f1d1d;
      --toast-bg: #d1fae5; --toast-fg: #065f46;
      --toast-err-bg: #fee2e2; --toast-err-fg: #991b1b;
      --shadow: 0 4px 12px rgba(15,23,42,0.08);
      --scroll-thumb: #cbd5e1; --scroll-thumb-hover: #94a3b8;
      --b-jsx-bg: #dbeafe;     --b-jsx-fg: #1e40af;
      --b-html-bg: #fef3c7;    --b-html-fg: #854d0e;
      --b-other-bg: #e2e8f0;   --b-other-fg: #334155;
      --b-svg-bg: #dcfce7;     --b-svg-fg: #166534;
      --b-mermaid-bg: #fae8ff; --b-mermaid-fg: #6b21a8;
      --b-whtml-bg: #fed7aa;   --b-whtml-fg: #9a3412;
      --iframe-bg: #ffffff;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); overflow: hidden; transition: background 0.15s, color 0.15s; }

    .app { display: grid; grid-template-rows: 56px 1fr; height: 100vh; }
    header.topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--bg-2); border-bottom: 1px solid var(--border); gap: 16px; transition: background 0.15s, border-color 0.15s; }
    header.topbar h1 { font-size: 15px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 12px; }
    header.topbar h1 .count { font-size: 12px; color: var(--text-faint); font-weight: 400; padding: 3px 8px; background: var(--bg-hover); border-radius: 4px; }
    .topbar-right { display: flex; align-items: center; gap: 10px; }
    .bulk-actions { display: flex; gap: 8px; align-items: center; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
    .bulk-actions.visible { opacity: 1; pointer-events: auto; }
    .bulk-actions .selected-count { color: var(--text-muted); font-size: 12px; }
    .theme-toggle { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.1s; line-height: 1; }
    .theme-toggle:hover { color: var(--text); border-color: var(--border-strong); background: var(--bg-hover); }

    .split { display: grid; grid-template-columns: 380px 1fr; min-height: 0; }
    .sidebar { background: var(--bg-1); border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; transition: background 0.15s, border-color 0.15s; }
    .preview-pane { display: flex; flex-direction: column; min-height: 0; background: var(--bg); }

    .sidebar-toolbar { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
    .search-box { width: 100%; padding: 7px 10px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 13px; outline: none; transition: border-color 0.15s; }
    .search-box:focus { border-color: var(--accent); }
    .search-box::placeholder { color: var(--text-dim); }

    .filter-bar { display: flex; gap: 4px; flex-wrap: wrap; }
    .filter-chip { padding: 3px 9px; background: var(--bg-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 4px; font-size: 11px; cursor: pointer; transition: all 0.1s; white-space: nowrap; }
    .filter-chip:hover { border-color: var(--border-strong); color: var(--text); }
    .filter-chip.active { border-color: var(--accent); color: var(--accent-text); background: var(--accent-bg-soft); }
    .filter-chip .chip-count { color: var(--text-dim); margin-left: 4px; font-size: 10px; }
    .filter-chip.active .chip-count { color: var(--accent-text); }

    .art-list { list-style: none; flex: 1; overflow-y: auto; padding: 6px 0; }
    .art-list::-webkit-scrollbar { width: 8px; }
    .art-list::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 4px; }
    .art-list::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }

    .art-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; cursor: pointer; border-left: 3px solid transparent; transition: background 0.1s; }
    .art-item:hover { background: var(--bg-hover); }
    .art-item.active { background: var(--accent-bg-soft); border-left-color: var(--accent); }
    .art-item.selected { background: var(--selected-bg); }
    .art-cb { margin-top: 3px; cursor: pointer; accent-color: var(--accent); flex-shrink: 0; }
    .art-item-body { flex: 1; min-width: 0; }
    .art-item-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
    .art-item-title { font-size: 13px; color: var(--text); font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .art-item.active .art-item-title { color: var(--text-strong); }
    .art-item-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-faint); }
    .art-item-meta code { background: transparent; color: var(--text-dim); padding: 0; font-size: 10.5px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .art-item-meta .meta-sep { color: var(--text-vdim); }
    .art-item-action { opacity: 0; background: transparent; border: 1px solid var(--border-strong); color: var(--text-faint); border-radius: 4px; padding: 2px 7px; cursor: pointer; font-size: 12px; transition: all 0.1s; flex-shrink: 0; align-self: center; }
    .art-item:hover .art-item-action { opacity: 1; }
    .art-item-action:hover { color: var(--text); border-color: var(--border-strongest); }

    .empty-list { padding: 24px 16px; text-align: center; color: var(--text-dim); font-size: 13px; }

    .type-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; flex-shrink: 0; }
    .art-jsx     { background: var(--b-jsx-bg);     color: var(--b-jsx-fg); }
    .art-html    { background: var(--b-html-bg);    color: var(--b-html-fg); }
    .art-other   { background: var(--b-other-bg);   color: var(--b-other-fg); }
    .wb-svg      { background: var(--b-svg-bg);     color: var(--b-svg-fg); }
    .wb-mermaid  { background: var(--b-mermaid-bg); color: var(--b-mermaid-fg); }
    .wb-html     { background: var(--b-whtml-bg);   color: var(--b-whtml-fg); }

    .tab-bar { display: flex; align-items: stretch; background: var(--bg-2); border-bottom: 1px solid var(--border); min-height: 38px; overflow-x: auto; flex-shrink: 0; transition: background 0.15s, border-color 0.15s; }
    .tab-bar::-webkit-scrollbar { height: 4px; }
    .tab-bar::-webkit-scrollbar-thumb { background: var(--scroll-thumb); }
    .tab { display: flex; align-items: center; gap: 8px; padding: 0 14px; border-right: 1px solid var(--border); cursor: pointer; max-width: 240px; min-width: 120px; transition: background 0.1s; position: relative; }
    .tab:hover { background: var(--accent-bg-soft); }
    .tab.active { background: var(--bg); }
    .tab.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--accent); }
    .tab-title { color: var(--text-muted); font-size: 12px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab.active .tab-title { color: var(--text); }
    .tab-close { background: transparent; border: none; color: var(--text-dim); font-size: 14px; cursor: pointer; padding: 2px 4px; border-radius: 3px; line-height: 1; transition: all 0.1s; }
    .tab-close:hover { background: var(--bg-hover); color: var(--text); }
    .tab-actions { display: flex; align-items: center; gap: 4px; padding: 0 12px; margin-left: auto; flex-shrink: 0; border-left: 1px solid var(--border); }
    .tab-action-btn { background: transparent; border: 1px solid var(--border); color: var(--text-faint); padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: all 0.1s; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
    .tab-action-btn:hover { border-color: var(--border-strong); color: var(--text); }
    .tab-action-btn.danger { color: var(--danger-text); border-color: var(--danger-border); }
    .tab-action-btn.danger:hover { background: var(--danger-bg-hover); color: var(--danger-text-strong); border-color: var(--danger-border); }

    .preview-frame { flex: 1; border: none; background: var(--iframe-bg); }
    .empty-preview { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; color: var(--text-dim); padding: 20px; text-align: center; }
    .empty-preview .hint-icon { font-size: 32px; opacity: 0.5; }
    .empty-preview h2 { font-size: 16px; color: var(--text-muted); font-weight: 500; }
    .empty-preview p { font-size: 13px; line-height: 1.5; max-width: 320px; }
    .empty-preview kbd { background: var(--bg-hover); padding: 2px 6px; border-radius: 3px; font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }

    .btn { padding: 5px 11px; border-radius: 4px; font-size: 12px; cursor: pointer; border: 1px solid transparent; text-decoration: none; line-height: 1.4; transition: all 0.1s; display: inline-flex; align-items: center; gap: 4px; }
    .btn-primary { background: var(--accent-bg); color: var(--text-strong); border-color: var(--accent-bg); }
    .btn-primary:hover { background: var(--accent-bg-hover); border-color: var(--accent-bg-hover); }
    .btn-secondary { background: transparent; color: var(--text-muted); border-color: var(--border-strong); }
    .btn-secondary:hover { background: var(--bg-hover); color: var(--text); }
    .btn-danger { background: transparent; color: var(--danger-text); border-color: var(--danger-border); }
    .btn-danger:hover { background: var(--danger-bg-hover); color: var(--danger-text-strong); }

    .toast { position: fixed; bottom: 16px; right: 16px; background: var(--toast-bg); color: var(--toast-fg); padding: 10px 16px; border-radius: 6px; display: none; font-size: 13px; z-index: 100; box-shadow: var(--shadow); }
    .toast.error { background: var(--toast-err-bg); color: var(--toast-err-fg); }

    .sidebar-toggle { display: none; }
    @media (max-width: 768px) {
      .split { grid-template-columns: 1fr; }
      .sidebar { position: absolute; top: 56px; left: 0; bottom: 0; width: 100%; max-width: 380px; z-index: 50; transform: translateX(-100%); transition: transform 0.2s; }
      .sidebar.open { transform: translateX(0); }
      .sidebar-toggle { display: inline-flex; }
    }

    .empty-gallery { padding: 60px 20px; text-align: center; color: var(--text-faint); }
    .empty-gallery h2 { font-size: 18px; color: var(--text-muted); margin-bottom: 8px; font-weight: 500; }
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
      <div class="topbar-right">
        <div class="bulk-actions" id="bulkActions">
          <span class="selected-count" id="selectedCount">0 selected</span>
          <button class="btn btn-danger" onclick="deleteSelected()">Delete selected</button>
          <button class="btn btn-secondary" onclick="clearSelection()">Clear</button>
        </div>
        <button class="theme-toggle" id="themeToggle" onclick="toggleTheme()" title="Toggle light/dark"><span id="themeIcon">☾</span></button>
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
    // ─── Theme toggle ───
    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('gal-theme', t); } catch(e) {}
      const icon = document.getElementById('themeIcon');
      if (icon) icon.textContent = t === 'light' ? '☾' : '☀';
    }
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(cur === 'light' ? 'dark' : 'light');
    }
    // Set the toggle icon to reflect the theme picked by the FOUC-prevention script.
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.documentElement.getAttribute('data-theme') || 'dark';
      const icon = document.getElementById('themeIcon');
      if (icon) icon.textContent = t === 'light' ? '☾' : '☀';
    });

    // ─── Tab management ───
    const openTabs = new Map();
    let activeSlug = null;

    function findItem(slug) {
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
      Array.from(bar.querySelectorAll('.tab')).forEach(el => el.remove());
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
      document.querySelectorAll('.art-item').forEach(item => {
        let show = true;
        if (currentFilter !== '*') {
          if (currentFilter.startsWith('kind:')) show = item.dataset.kind === currentFilter.slice(5);
          else if (currentFilter.startsWith('f:')) show = item.dataset.filter === currentFilter.slice(2);
        }
        if (show && q) {
          const hay = (item.dataset.title + ' ' + item.dataset.slug).toLowerCase();
          show = hay.includes(q);
        }
        item.style.display = show ? '' : 'none';
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
        } else { showToast('Error: ' + (data.error || 'Unknown'), true); }
      } catch (e) { showToast('Error: ' + e.message, true); }
    }
    async function deleteCurrentTab() {
      if (!activeSlug) return;
      const tab = openTabs.get(activeSlug);
      if (!confirm('Delete "' + (tab?.title || activeSlug) + '"?')) return;
      try {
        const res = await fetch('/api/artifacts/' + activeSlug, { method: 'DELETE' });
        if (res.ok) { showToast('Deleted: ' + activeSlug); setTimeout(() => location.reload(), 600); }
        else { const err = await res.json(); showToast('Error: ' + (err.error || 'Unknown'), true); }
      } catch (e) { showToast('Error: ' + e.message, true); }
    }

    function showToast(msg, isError) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.toggle('error', !!isError);
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }
    function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

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
