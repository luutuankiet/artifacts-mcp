export function galleryHtml(artifacts, baseUrl) {
  const rows = artifacts.map(a => `
    <tr data-slug="${esc(a.slug)}">
      <td class="checkbox-col"><input type="checkbox" class="artifact-cb" value="${esc(a.slug)}" /></td>
      <td><a href="${a.url}" target="_blank">${esc(a.title)}</a></td>
      <td><code>${esc(a.slug)}</code></td>
      <td>${esc(a.format)}</td>
      <td>${a.size_kb} KB</td>
      <td>${new Date(a.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td>
        <a href="${a.url}" target="_blank" class="btn btn-open">Open</a>
        <a href="${a.url}" download="${esc(a.slug)}.html" class="btn btn-download">Download</a>
        <button class="btn btn-delete" onclick="deleteArtifact('${esc(a.slug)}')">Delete</button>
      </td>
    </tr>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Artifact Gallery</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 1rem; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid #334155; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 600; }
    .count { color: #94a3b8; font-size: 0.9rem; }
    .bulk-actions { display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0; margin-bottom: 0.5rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    .bulk-actions.visible { opacity: 1; pointer-events: auto; }
    .bulk-actions .selected-count { color: #94a3b8; font-size: 0.85rem; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 0.75rem; color: #94a3b8; font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #334155; }
    td { padding: 0.75rem; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
    tr:hover { background: #1e293b; }
    tr.selected { background: #1e3a5f; }
    .checkbox-col { width: 40px; text-align: center; }
    input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; accent-color: #6366f1; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1e293b; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; color: #94a3b8; }
    .btn { display: inline-block; padding: 0.3rem 0.7rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer; border: none; text-decoration: none; }
    .btn-open { background: #1e40af; color: #fff; }
    .btn-open:hover { background: #2563eb; text-decoration: none; }
    .btn-download { background: #1e3a5f; color: #93c5fd; margin-left: 0.3rem; }
    .btn-download:hover { background: #1d4ed8; text-decoration: none; }
    .btn-delete { background: #7f1d1d; color: #fca5a5; margin-left: 0.3rem; }
    .btn-delete:hover { background: #991b1b; }
    .btn-bulk-delete { background: #991b1b; color: #fca5a5; padding: 0.4rem 1rem; font-size: 0.85rem; }
    .btn-bulk-delete:hover { background: #b91c1c; }
    .empty { text-align: center; padding: 3rem; color: #64748b; }
    .toast { position: fixed; bottom: 1rem; right: 1rem; background: #065f46; color: #d1fae5; padding: 0.75rem 1.25rem; border-radius: 6px; display: none; font-size: 0.9rem; z-index: 100; }
    @media (max-width: 768px) {
      table, thead, tbody, th, td, tr { display: block; }
      thead { display: none; }
      tr { margin-bottom: 0.75rem; background: #1e293b; border-radius: 6px; padding: 0.5rem; }
      td { padding: 0.4rem 0.75rem; border: none; display: flex; justify-content: space-between; }
      td::before { content: attr(data-label); font-weight: 500; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Artifact Gallery</h1>
    <span class="count">${artifacts.length} artifact${artifacts.length !== 1 ? 's' : ''}</span>
  </div>
  ${artifacts.length === 0 ? '<div class="empty">No artifacts yet. Publish one via the MCP endpoint.</div>' : `
  <div class="bulk-actions" id="bulkActions">
    <span class="selected-count" id="selectedCount">0 selected</span>
    <button class="btn btn-bulk-delete" onclick="deleteSelected()">Delete Selected</button>
  </div>
  <table>
    <thead>
      <tr>
        <th class="checkbox-col"><input type="checkbox" id="selectAll" onclick="toggleSelectAll()" title="Select all" /></th>
        <th>Title</th><th>Slug</th><th>Format</th><th>Size</th><th>Created</th><th>Actions</th>
      </tr>
    </thead>
    <tbody id="artifactList">
      ${rows}
    </tbody>
  </table>`}
  <div class="toast" id="toast"></div>
  <script>
    function getSelectedSlugs() {
      return Array.from(document.querySelectorAll('.artifact-cb:checked')).map(cb => cb.value);
    }
    function updateBulkUI() {
      var selected = getSelectedSlugs();
      var bulkBar = document.getElementById('bulkActions');
      var countEl = document.getElementById('selectedCount');
      if (bulkBar) {
        bulkBar.className = selected.length > 0 ? 'bulk-actions visible' : 'bulk-actions';
        countEl.textContent = selected.length + ' selected';
      }
      // Highlight selected rows
      document.querySelectorAll('#artifactList tr').forEach(function(tr) {
        var cb = tr.querySelector('.artifact-cb');
        tr.classList.toggle('selected', cb && cb.checked);
      });
      // Update select-all checkbox state
      var selectAll = document.getElementById('selectAll');
      var allCbs = document.querySelectorAll('.artifact-cb');
      if (selectAll && allCbs.length > 0) {
        selectAll.checked = selected.length === allCbs.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < allCbs.length;
      }
    }
    function toggleSelectAll() {
      var selectAll = document.getElementById('selectAll');
      document.querySelectorAll('.artifact-cb').forEach(function(cb) {
        cb.checked = selectAll.checked;
      });
      updateBulkUI();
    }
    // Listen for individual checkbox changes
    document.addEventListener('change', function(e) {
      if (e.target.classList.contains('artifact-cb')) updateBulkUI();
    });
    async function deleteSelected() {
      var slugs = getSelectedSlugs();
      if (slugs.length === 0) return;
      if (!confirm('Delete ' + slugs.length + ' artifact(s)?')) return;
      try {
        var res = await fetch('/api/artifacts/batch', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: slugs })
        });
        var data = await res.json();
        if (res.ok) {
          showToast('Deleted ' + data.deleted + ' artifact(s)');
          setTimeout(function() { location.reload(); }, 500);
        } else {
          showToast('Error: ' + (data.error || 'Unknown'), true);
        }
      } catch(e) {
        showToast('Error: ' + e.message, true);
      }
    }
    async function deleteArtifact(slug) {
      if (!confirm('Delete artifact "' + slug + '"?')) return;
      try {
        var res = await fetch('/api/artifacts/' + slug, { method: 'DELETE' });
        if (res.ok) {
          showToast('Deleted: ' + slug);
          setTimeout(function() { location.reload(); }, 500);
        } else {
          var err = await res.json();
          showToast('Error: ' + (err.error || 'Unknown'), true);
        }
      } catch(e) {
        showToast('Error: ' + e.message, true);
      }
    }
    function showToast(msg, isError) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = isError ? '#7f1d1d' : '#065f46';
      t.style.display = 'block';
      setTimeout(function() { t.style.display = 'none'; }, 3000);
    }
  </script>
</body>
</html>`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
