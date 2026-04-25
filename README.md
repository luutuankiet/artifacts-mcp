# artifacts-mcp

Self-hosted MCP artifact server — publish JSX/HTML/SVG/Mermaid as browsable, persistent, validated artifacts via [Model Context Protocol](https://modelcontextprotocol.io/).

## Two Render Paths

### 1. `publish_artifact` — Full React/JSX Apps

```
MCP Client → publish_artifact({ source: "<JSX>", title: "My App" })
    → Server compiles JSX with esbuild (2-15ms)
    → Wraps in HTML template (React + Tailwind CDN + require shim)
    → Validates in headless Chromium (#root mounted, no errors)
    → Saves to artifacts/YYYY-MM-DD-slug.html
    → Returns permanent browsable URL
```

### 2. `write_whiteboard` — Instant SVG / Mermaid / HTML Visuals (v2.2)

```
MCP Client → write_whiteboard({ content: "graph TD\n  A-->B", title: "Flow" })
    → Auto-detects format (mermaid / svg / html)
    → Wraps in viewer template with chrome (Copy / Download / Gallery)
    → Persists to artifacts/ as a first-class entry
    → Validates render in headless Chromium (mermaid renders, no errors)
    → Broadcasts to /whiteboard SSE for live browser tab
    → Returns permanent browsable URL + live whiteboard URL
```

**Why use it over publish_artifact?**
- 10–100x faster: zero compile, zero CDN React stack, sub-second render
- Token-efficient: a 50-token mermaid diagram encodes what 500 tokens of SVG would
- Auto-validation catches syntax errors before the URL is returned
- `patch_whiteboard` lets you fix broken diagrams without resending the full source
- Persisted by default — every call adds a slide to the gallery (great for slide-deck workflows)
- Pass `persist:false` for ephemeral broadcast-only updates

## MCP Tools

| Tool | Description |
|------|-------------|
| `publish_artifact` | Publish JSX or raw HTML as a browsable artifact (esbuild + headless validation for JSX) |
| `patch_artifact` | Apply search/replace patches to an artifact's stored source and re-validate |
| `validate_artifact` | Re-validate a published artifact in headless Chromium |
| `write_whiteboard` | Publish SVG / Mermaid / HTML fragment as a persistent visual artifact + live broadcast (v2.2) |
| `patch_whiteboard` | Apply search/replace patches to a whiteboard's stored source and re-validate (v2.2) |
| `list_artifacts` | List all published artifacts and whiteboards with type metadata |
| `get_artifact` | Get metadata and URL for a specific slug |
| `delete_artifact` | Delete an artifact or whiteboard by slug |

## Supported Libraries

Core (always included): React 18, ReactDOM, Tailwind CSS

Optional (auto-detected from source or manual): recharts, lucide-react, d3, three.js, chart.js, papaparse, mathjs, lodash, tone.js

Library versions defined in `libs.json` — add your own CDN libs there.

## Quick Start

```bash
git clone https://github.com/luutuankiet/artifacts-mcp.git
cd artifacts-mcp
npm install

# Configure
cp .env.example .env
# Edit .env with your BASE_URL

# Run
npm start
# Server at http://localhost:3333
# Gallery:    http://localhost:3333/
# Whiteboard: http://localhost:3333/whiteboard
# MCP:        http://localhost:3333/mcp
```

## Docker

```bash
cp docker-compose.example.yaml docker-compose.yaml
# Edit docker-compose.yaml with your domain + auth
docker compose up -d --build
```

## MCP Client Configuration

```json
{
  "name": "artifacts",
  "url": "https://your-domain.example.com/mcp",
  "protocol": "http"
}
```

Implements [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) (2025-03-26 spec).

## Tests

```bash
# JSX E2E stress suite (37 tests — compilation, rendering, edge cases)
node tests/e2e-stress.mjs

# Whiteboard E2E (28 tests — SSE, persistence, mermaid, patch_whiteboard, lifecycle)
node tests/whiteboard-e2e.mjs

# Playwright render smoke tests (auto-skips whiteboards / html-passthrough)
node tests/render-smoke.mjs

# Remote with auth
ARTIFACT_HOST=your-domain.example.com ARTIFACT_AUTH=user:pass node tests/e2e-stress.mjs
```

## Architecture

```
artifact-server/
├── src/
│   ├── index.js                  # Express server, routes, static serving
│   ├── mcp.js                    # JSON-RPC MCP endpoint (8 tools)
│   ├── compiler.js               # normalizeSource() + esbuild JSX→CJS
│   ├── template.js               # buildHtml() — wraps compiled JS with CDN libs
│   ├── storage.js                # Filesystem CRUD (artifacts/ + .meta/)
│   ├── validator.js              # Playwright validateArtifact + validateWhiteboard
│   ├── gallery.js                # Gallery (type badges, filter chips, multi-select)
│   ├── whiteboard.js             # SSE broadcast + persistWhiteboard helper
│   └── whiteboard-template.js    # Viewer wrappers: SVG / Mermaid / HTML (v2.2)
├── tests/
│   ├── e2e-stress.mjs            # 37 MCP protocol + compilation tests
│   ├── whiteboard-e2e.mjs        # 28 whiteboard tests (SSE + persistence + mermaid + patch)
│   └── render-smoke.mjs          # Playwright render verification (type-aware)
├── artifacts/                    # HTML output files (bind-mounted)
│   └── .meta/                    # JSON metadata + raw source per artifact
├── libs.json                     # CDN library manifest (incl. mermaid)
├── docker-compose.yaml           # Container config + Traefik labels
└── package.json
```

- **Server-side esbuild compilation** — JSX→CJS in 2-15ms, syntax errors at publish time
- **First-class whiteboards** — SVG / Mermaid / HTML fragments persist to the gallery with stable URLs (v2.2)
- **Auto-validation** — every persisted artifact loads in headless Chromium before the URL is returned
- **Patch flow** — `patch_artifact` and `patch_whiteboard` apply search/replace fixes against stored source, no full retransmit
- **Live broadcast** — `/whiteboard` SSE tab still updates instantly; persistence is additive
- **Gallery UI** — type badges (JSX / SVG / Mermaid / HTML), filter chips, multi-select delete
- **Auth** — designed for reverse proxy auth (Traefik basicauth, nginx, etc.)

## License

MIT
