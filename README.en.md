<div align="center">

# Keepsake

**A self-hosted home inventory PWA — know what you own, where it lives.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

English · [简体中文](./README.md)

<!-- Cover screenshot placeholder (suggested: composite of desktop room list + mobile item detail, ~800px wide) -->
![cover](docs/img/cover.png)

</div>

> Single-family, single-server by design. All data stays on your LAN, and the AI key is yours.

## Why Keepsake

Where did that bottle of disinfectant from six months ago go? How many spare batteries are left on the balcony? Which box did the winter coats get packed into?

These all sound like "I'll remember next time" problems — but we don't. The location of low-frequency household items barely registers in long-term memory.

Existing options aren't great either: too heavy (Notion / Excel — manual typing, family account headaches), too light (snapping a photo and losing it in your camera roll), or too cloud-dependent (commercial inventory apps that need to know everything you own).

Keepsake takes another route:

- **Runs in your home**: a single SQLite file plus a Fastify server, dropped on an always-on PC or NAS. Every device in the house talks to it over the LAN.
- **Offline-first**: every CRUD writes IndexedDB first; sync kicks in the moment the server is reachable. Works without network.
- **AI is a topping, not the main dish**: optional DeepSeek / OpenRouter integration so you can say "bought three bottles of shampoo and a tube of toothpaste" and have it auto-structured. Skip it and manual entry still works fine.
- **Privacy by default**: your AI key lives in the browser, requests go **directly to the AI provider** with no relay through anyone's server (not even your own home server). Item data never leaves the LAN.

## Features

**📦 Inventory management**
- Three-level hierarchy: Room → Area → Item (e.g. Kitchen → Vanity Cabinet → Disinfectant × 2)
- Preset room/area names (Kitchen, Balcony, Vanity Cabinet, Drawer…) for one-tap creation
- Items support name, qty, unit, notes, expiry date, tags, photos

**🤖 AI assist** (optional)
- **Natural-language input**: "bought three bottles of shampoo and a tube of toothpaste" → 3 items
- **Natural-language search**: "any band-aids in the bathroom?" → AI answers from the full inventory
- Supports DeepSeek (cheap) and OpenRouter (model variety)

**🔄 Multi-device sync**
- iOS / Android / desktop browsers all editable, auto pull/push merge
- 4 sync ops (upsert / delete / qty_delta / patch), field-level Last-Write-Wins
- Auto-syncs every 60s when online or on app focus; conflicts surface as a top banner with manual resolution

**📴 Offline & backup**
- IndexedDB-first, query and edit work offline
- Server runs `VACUUM INTO` weekly, keeps 4 snapshots by default
- One-click full JSON export from the settings page

**🌏 Bilingual**
- UI in Chinese / English
- AI system prompts switch language to match

## Tech Stack

| Side | Stack |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript + Tailwind + Dexie (IndexedDB) |
| Backend | Fastify + better-sqlite3, single process single file |
| AI | DeepSeek or OpenRouter, **direct from client** |
| Shared | `packages/shared` sync protocol + merge rules, used by both ends |

More: [`docs/02-implementation.md`](docs/02-implementation.md)

## Quick Start

### 1. Install + build

```bash
pnpm install        # includes better-sqlite3 native compile, ~4 min on first run
pnpm build          # build shared / pwa / server in order
```

### 2. Set up HTTPS (strongly recommended)

Modern browsers restrict fetch / IndexedDB / camera permissions outside a secure context. Use mkcert to issue a local cert for your LAN IP:

```bash
brew install mkcert nss
mkcert -install
cd apps/server && mkdir -p certs && cd certs
mkcert -cert-file dev-cert.pem -key-file dev-key.pem \
  192.168.x.x localhost 127.0.0.1
```

See [`docs/HTTPS-SETUP.md`](docs/HTTPS-SETUP.md) (includes Android CA install).

### 3. Start

```bash
KEEPSAKE_TLS=1 pnpm start
```

Console will print:

```
╔════════════════════════════════════════════════╗
║ 🗝  Keepsake Server is running                  ║
╠════════════════════════════════════════════════╣
║ LAN      https://192.168.31.181:8443           ║
╚════════════════════════════════════════════════╝
```

Open the LAN URL on every device in your home.

> ⚠️ `localhost` is blocked by the server (to avoid IndexedDB origin mismatch making data appear "lost"). Always use the LAN IP. For dev access via localhost, set `KEEPSAKE_ALLOW_LOCALHOST=1`.

### 4. Configure AI (optional)

Settings → "AI Assistant" → pick DeepSeek or OpenRouter → paste your API key → test → save. The key syncs to your home server so other devices pick it up on launch (one key for the whole family).

## Demo

### Add room / area / item

<!-- GIF placeholder: empty room list → tap + → pick "Kitchen" preset → enter → add "Vanity Cabinet" → tap "Text input" → AI parse -->
![add-item](docs/img/add-item.gif)

### Search

<!-- GIF placeholder: type "band-aid" in search → list result → tap to jump to area -->
![search-item](docs/img/search.gif)

### Multi-device sync

<!-- GIF placeholder: phone on left, desktop on right; edit one, see update on the other -->
![sync](docs/img/sync.gif)

## Project Layout

```
Keepsake/
├── apps/
│   ├── pwa/      # React + Vite + Dexie frontend
│   └── server/   # Fastify + better-sqlite3 backend
├── packages/
│   └── shared/   # Types + sync protocol + merge rules
└── docs/         # Design, implementation, testing, QA reports
```

## Development

```bash
# Terminal A: watch shared package
pnpm -C packages/shared build -w

# Terminal B: backend hot-reload
pnpm -C apps/server dev

# Terminal C: frontend dev server (5173, proxies /sync /blobs /settings to 8443)
pnpm -C apps/pwa dev
```

### Tests

```bash
pnpm -C packages/shared test    # merge rules, sync protocol, patch op
pnpm -C apps/pwa test           # AI router, i18n, item-repo, patch
pnpm -C apps/server test        # /sync pull/push, LWW, qty_delta, patch
```

No e2e / Playwright. UI verification is manual + the QA flow described in [`.claude/agents/qa.md`](.claude/agents/qa.md).

## Environment Variables (server)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8443` | Listen port |
| `KEEPSAKE_DB` | `./data/keepsake.sqlite` | DB file path |
| `KEEPSAKE_TLS` | unset | `1` to enable HTTPS (requires mkcert cert) |
| `KEEPSAKE_TLS_CERT` | `apps/server/certs/dev-cert.pem` | Custom cert path |
| `KEEPSAKE_TLS_KEY` | `apps/server/certs/dev-key.pem` | Custom key path |
| `KEEPSAKE_BACKUP_INTERVAL_DAYS` | `7` | Backup interval in days |
| `KEEPSAKE_BACKUP_KEEP` | `4` | Number of backups to retain |
| `KEEPSAKE_ALLOW_LOCALHOST` | unset | `1` allows localhost SPA access (dev only) |
| `LOG_LEVEL` | `info` | Fastify log level |

## Documentation

- [`docs/01-plan.md`](docs/01-plan.md) — Vision, scope, architecture, data model, sync protocol
- [`docs/02-implementation.md`](docs/02-implementation.md) — Tech stack, layout, key modules
- [`docs/03-testing.md`](docs/03-testing.md) — Testing status + QA flow
- [`docs/HTTPS-SETUP.md`](docs/HTTPS-SETUP.md) — mkcert + Android CA
- [`docs/storage-plan.md`](docs/storage-plan.md) — IndexedDB / Blob / backup strategy
- [`docs/explorations.md`](docs/explorations.md) — Dead ends (deprecated PWA, cloudflared, etc.)
- [`docs/qa-reports/`](docs/qa-reports/) — QA report archive

## Roadmap

See [GitHub Issues](https://github.com/luzion89/keepsake/issues). Current focus:

- Proper e2e tests (currently manual + QA agent)
- Item photo recognition (DeepSeek lacks vision; waiting for stable OpenRouter vision models)
- Further mobile polish

## License

[MIT](./LICENSE) © 2026 luzion89

A home project. Fork freely. If it's useful to you too, leave a ⭐ to let me know.
