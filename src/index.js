import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handleMcp } from './mcp.js';
import { listArtifacts } from './storage.js';
import { galleryHtml } from './gallery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const app = express();

// Parse JSON bodies (for MCP)
app.use(express.json({ limit: '5mb' }));

// Static file serving for built artifacts
app.use('/artifacts', express.static(resolve(__dirname, '..', 'artifacts')));

// Gallery — management console
app.get('/', async (req, res) => {
  try {
    const artifacts = await listArtifacts(BASE_URL);
    res.type('html').send(galleryHtml(artifacts, BASE_URL));
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Gallery API endpoints — batch route MUST come before :slug param route
app.delete('/api/artifacts/batch', express.json(), async (req, res) => {
  try {
    const { slugs } = req.body;
    if (!Array.isArray(slugs) || slugs.length === 0) {
      return res.status(400).json({ error: 'slugs array required' });
    }
    const { deleteArtifact } = await import('./storage.js');
    let deleted = 0;
    const errors = [];
    for (const slug of slugs) {
      try {
        const ok = await deleteArtifact(slug);
        if (ok) deleted++;
        else errors.push(`${slug}: not found`);
      } catch (e) {
        errors.push(`${slug}: ${e.message}`);
      }
    }
    res.json({ deleted, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/artifacts/:slug', (req, res) => {
  import('./storage.js').then(({ deleteArtifact }) => {
    deleteArtifact(req.params.slug)
      .then(deleted => {
        if (!deleted) return res.status(404).json({ error: 'Not found' });
        res.json({ deleted: true, slug: req.params.slug });
      })
      .catch(err => res.status(500).json({ error: err.message }));
  });
});



// MCP endpoint (SDK-backed)
handleMcp(app, BASE_URL);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`artifact-server listening on :${PORT}`);
  console.log(`  Gallery:   ${BASE_URL}/`);
  console.log(`  Artifacts: ${BASE_URL}/artifacts/`);
  console.log(`  MCP:       ${BASE_URL}/mcp`);
  console.log(`  Auth:      Traefik basicauth`);
});
