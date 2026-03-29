# artifacts-mcp

Self-hosted MCP artifact server — publish JSX/HTML as browsable URLs via [Model Context Protocol](https://modelcontextprotocol.io/).

Any MCP client (Claude Code, Claude Desktop, etc.) can call `publish_artifact` to compile JSX source into a standalone HTML page served at a permanent URL. No build step needed — Babel compiles JSX client-side in the browser.

## How it works

```
MCP Client → publish_artifact({ source: "<JSX>", title: "My App" })
    → Server wraps in HTML template (React + Babel + Tailwind CDN)
    → Saves to artifacts/YYYY-MM-DD-slug.html
    → Returns browsable URL
    → Browser loads page, Babel compiles JSX client-side
    → Interactive React app renders
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `publish_artifact` | Publish JSX or HTML as a browsable artifact |
| `list_artifacts` | List all published artifacts with metadata |
| `get_artifact` | Get metadata and URL for a specific artifact |
| `delete_artifact` | Delete an artifact by slug |

## Supported Libraries

Core (always included): React 18, ReactDOM, Babel Standalone, Tailwind CSS

Optional (request via `libraries` param): recharts, lucide-react, d3, three.js, chart.js, papaparse, mathjs, lodash, tone.js

Library versions are defined in `libs.json` — add your own CDN libs there.

## Quick Start

```bash
# Clone and install
git clone https://github.com/luutuankiet/artifacts-mcp.git
cd artifacts-mcp
npm install

# Configure
cp .env.example .env
# Edit .env with your BASE_URL

# Run
npm start
# Server at http://localhost:3333
# Gallery: http://localhost:3333/
# MCP endpoint: http://localhost:3333/mcp
```

## Docker

```bash
cp docker-compose.example.yaml docker-compose.yaml
# Edit docker-compose.yaml with your domain + auth
docker compose up -d --build
```

## MCP Client Configuration

Add to your MCP client config:

```json
{
  "name": "artifacts",
  "url": "https://your-domain.example.com/mcp",
  "protocol": "http"
}
```

The server implements [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) (2025-03-26 spec).

## E2E Test

```bash
# Local
node e2e-test.cjs

# Remote with auth
ARTIFACT_HOST=your-domain.example.com ARTIFACT_AUTH=user:pass node e2e-test.cjs
```

## Architecture

- **Hand-rolled MCP server** (Express + JSON-RPC) — works but planned migration to `@modelcontextprotocol/sdk`
- **Client-side JSX compilation** via Babel Standalone — no server-side build step
- **Filesystem storage** — `artifacts/` dir is the database, `.meta/` holds JSON metadata
- **Gallery UI** — built-in HTML gallery at `/` with delete actions
- **Auth** — designed for reverse proxy auth (Traefik basicauth, nginx, etc.)

## TODO

- [ ] Migrate hand-rolled MCP server to `@modelcontextprotocol/sdk`
- [ ] E2E test suite (publish → verify render → cleanup)
- [ ] Artifact versioning / history
- [ ] Source map support for debugging
- [ ] Gallery search / filter

## License

MIT
