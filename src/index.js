import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handleMcp } from './mcp.js';
import { listArtifacts } from './storage.js';
import { galleryHtml } from './gallery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3333;
const API_KEY = process.env.API_KEY || '';
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

// Gallery API endpoints (for delete actions)
app.delete('/api/artifacts/:slug', (req, res) => {
  const providedKey = req.query.apikey || req.headers['x-api-key'];
  if (API_KEY && providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  import('./storage.js').then(({ deleteArtifact }) => {
    deleteArtifact(req.params.slug)
      .then(deleted => {
        if (!deleted) return res.status(404).json({ error: 'Not found' });
        res.json({ deleted: true, slug: req.params.slug });
      })
      .catch(err => res.status(500).json({ error: err.message }));
  });
});

// MCP endpoint
handleMcp(app, API_KEY, BASE_URL);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`artifact-server listening on :${PORT}`);
  console.log(`  Gallery:   ${BASE_URL}/`);
  console.log(`  Artifacts: ${BASE_URL}/artifacts/`);
  console.log(`  MCP:       ${BASE_URL}/mcp`);
  console.log(`  API key:   ${API_KEY ? 'required' : 'NONE (open)'}`);  
});
