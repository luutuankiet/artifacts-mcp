# Project

*Initialized: 2026-03-29*

## What This Is

A self-hosted Docker server that accepts React/JSX artifact source code via MCP endpoints, compiles it to self-contained interactive HTML, serves the output at browsable URLs, and provides a gallery to manage all artifacts. Bridges the gap between Claude.ai's native JSX rendering and Claude Code cloud sessions which have no built-in preview capability.

## Core Value

**Claude Code cloud sessions can produce and view interactive HTML artifacts the same way Claude.ai does natively** — without requiring a local machine, browser, or manual build steps.

## Success Criteria

Project succeeds when:
- [ ] Docker container running on Hetzner Helsinki behind Traefik
- [ ] MCP `publish_artifact` tool accepts JSX source, returns viewable URL
- [ ] Built artifacts served at `artifacts.kenluu.org/<name>.html`
- [ ] Gallery index page lists all artifacts with metadata (title, date, size)
- [ ] Cleanup: delete individual artifacts or bulk-expire old ones
- [ ] Mobile-friendly viewing on Android
- [ ] Shareable links work for anyone (no auth required for viewing)
- [ ] Claude Code can call the MCP endpoint via proxy chain

## Context

**Origin story:**
This project was born during a Claude.ai teaching session where two interactive React artifacts were built to explain networking concepts (HTTP, HTTPS, SSE, WebSocket, STDIO) using the user's own GCP proxy infrastructure as examples. The artifacts (`network-layers.jsx`, `stdio-deep-dive.jsx`) rendered beautifully in Claude.ai's built-in React runtime. The question arose: how can Claude Code (especially cloud sessions with no local server access) produce the same kind of interactive content?

**The gap:**
Claude.ai has a built-in mini React runtime baked into its chat frontend. When a `.jsx` file is placed in `/mnt/user-data/outputs/`, the frontend compiles JSX on-the-fly, loads React + pre-bundled libraries (Tailwind, Recharts, Lucide, D3, Three.js, shadcn/ui), and renders inside a sandboxed iframe. Claude Code cloud sessions have no equivalent — they can write files but have no way to compile or preview them.

**Research findings (LOG-001, LOG-002):**
Searched GitHub, Google Grounding, Reddit via MCP proxy. Found several partial solutions but nobody has built the specific combo of MCP endpoint + build pipeline + static server + gallery in one container. Key existing tools: `claude-artifact-runner` (CLI build tool), `LLM-React-Artifact-Render-Server` (paste-based, no MCP), Claude Code Desktop preview MCP (local only).

**Infrastructure:**
- Deploy target: Hetzner Helsinki (existing server, 4 vCPU, 8GB RAM)
- Reverse proxy: Traefik already running, handles TLS via Let's Encrypt
- Domain: `artifacts.kenluu.org` (new Cloudflare DNS entry)
- MCP access: via `swmcpproxy.kenluu.org` proxy chain (GCP Singapore)

## Constraints

- **Hetzner resources:** Must coexist with existing services (RSS, crawl4ai, monitoring, syncthing). Budget ~200-400MB RAM for this container.
- **No heavy runtimes:** No full Puppeteer/headless browser — just compile JSX to HTML. Keep it lightweight.
- **Manageable:** Easy cleanup, browsable gallery, no state database needed (filesystem is fine).
- **Docker only:** Single container, `docker-compose.yaml`, `restart: unless-stopped`.
- **Security:** Artifacts are public (viewable by anyone with URL). MCP write endpoint should require API key.

---
*Last updated: 2026-03-29 — Initialized from Claude.ai research session*