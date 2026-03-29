# artifacts-mcp

Self-hosted MCP artifact server — publish JSX/HTML as browsable URLs and push instant SVG diagrams to a live whiteboard via [Model Context Protocol](https://modelcontextprotocol.io/).

## Two Render Paths

### 1. `publish_artifact` — Full React/JSX Apps

```
MCP Client → publish_artifact({ source: "<JSX>", title: "My App" })
    → Server compiles JSX with esbuild (2-15ms)
    → Wraps in HTML template (React + Tailwind CDN + require shim)
    → Saves to artifacts/YYYY-MM-DD-slug.html
    → Returns permanent browsable URL
```

### 2. `write_whiteboard` — Instant SVG/HTML Diagrams

```
MCP Client → write_whiteboard({ content: "<svg>...</svg>", title: "Architecture" })
    → Server pushes to all connected browsers via SSE
    → Browser renders natively — zero compilation, zero CDN
    → Sub-second from tool call to paint
```

Open `/whiteboard` in a browser tab. Every `write_whiteboard` call updates it instantly.

## MCP Tools

| Tool | Description |
|------|-------------|
| `publish_artifact` | Publish JSX or HTML as a browsable artifact (esbuild compiled) |
| `write_whiteboard` | Push SVG/HTML to the live whiteboard (instant SSE render) |
| `list_artifacts` | List all published artifacts with metadata |
| `get_artifact` | Get metadata and URL for a specific artifact |
| `delete_artifact` | Delete an artifact by slug |

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
# E2E stress suite (37 tests — compilation, rendering, edge cases)
node tests/e2e-stress.mjs

# Whiteboard E2E (19 tests — SSE, MCP tool, format detection, lifecycle)
node tests/whiteboard-e2e.mjs

# Playwright render smoke tests
node tests/render-smoke.mjs

# Remote with auth
ARTIFACT_HOST=your-domain.example.com ARTIFACT_AUTH=user:pass node tests/e2e-stress.mjs
```

## Architecture

```
artifact-server/
├── src/
│   ├── index.js          # Express server, routes, static serving
│   ├── mcp.js            # Hand-rolled JSON-RPC MCP endpoint (5 tools)
│   ├── compiler.js       # normalizeSource() + esbuild JSX→CJS compilation
│   ├── template.js       # buildHtml() — wraps compiled JS in HTML with CDN libs
│   ├── storage.js        # Filesystem CRUD (artifacts/ + .meta/ JSON)
│   ├── gallery.js        # Gallery HTML page (multi-select delete, download)
│   └── whiteboard.js     # SSE whiteboard (broadcast, page, download)
├── tests/
│   ├── e2e-stress.mjs    # 37 MCP protocol + compilation tests
│   ├── whiteboard-e2e.mjs # 19 whiteboard SSE + MCP tool tests
│   └── render-smoke.mjs  # Playwright headless Chromium render verification
├── artifacts/            # Bind-mounted HTML output files
│   └── .meta/            # JSON metadata per artifact
├── libs.json             # CDN library manifest
├── docker-compose.yaml   # Container config + Traefik labels
└── package.json
```

- **Server-side esbuild compilation** — JSX→CJS in 2-15ms, syntax errors at publish time
- **SSE whiteboard** — instant SVG/HTML push to connected browsers, zero compilation
- **Filesystem storage** — `artifacts/` dir is the database, `.meta/` holds JSON metadata
- **Gallery UI** — built-in at `/` with multi-select delete + download buttons
- **Auth** — designed for reverse proxy auth (Traefik basicauth, nginx, etc.)

## License

MIT
