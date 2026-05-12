# ![LabStock](public/img/labstock.png) LabStock

**Self-hosted lab inventory management system.**

[![Build](https://github.com/neightgar/labstock/actions/workflows/docker.yml/badge.svg)](https://github.com/neightgar/labstock/actions/workflows/docker.yml)
[![Image](https://ghcr.io/neightgar/labstock:latest)](https://github.com/neightgar/labstock/pkgs/container/labstock)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Features

- **Reagents, consumables, equipment** — full inventory management with filters, pagination, and XLSX import/export
- **Soft delete & trash bin** — records are never permanently lost unless you choose
- **Protocols (SOP)** — rich-text editor (TipTap) with version history
- **Order list** — track items to reorder, export to Excel in one click
- **Workspaces** — isolate data between lab groups; admin sees all, users see their workspace
- **Roles** — administrator and regular user
- **Full-text search** — global FTS5 search across all entity types
- **QR codes** — generate and download QR codes for equipment cards
- **Telegram Bot** — `/low`, `/expiring`, `/search`, `/orders`, daily push notifications
- **REST API** — full CRUD API with Swagger UI at `/api/docs`
- **Bilingual UI** — Russian and English, switchable per user
- **Auto-backup** — scheduled SQLite backup via node-cron

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Web framework | Express |
| Database | SQLite (WAL mode) |
| ORM | Prisma |
| Templates | EJS |
| Rich-text editor | TipTap |
| Auth | bcrypt + express-session |
| Excel | exceljs |
| Scheduling | node-cron |
| Containerisation | Docker (multi-arch: amd64 / arm64) |

---

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/neightgar/labstock/main/install.sh | bash
```

Supports Linux (Ubuntu/Debian) and Synology NAS.
Automatically detects the platform and selects Docker or bare metal installation.

---

## Installation

### Option A — Docker (recommended)

**Step 1 — Create directories**

```bash
# Generic server
mkdir -p /opt/labstock/{data,uploads,backups}
cd /opt/labstock

# Synology NAS
mkdir -p /volume1/docker/labstock/{data,uploads,backups}
cd /volume1/docker/labstock
```

**Step 2 — Create `docker-compose.yml`**

```yaml
services:
  labstock:
    image: ghcr.io/neightgar/labstock:latest
    container_name: labstock

    restart: unless-stopped

    ports:
      - "3120:3000"

    volumes:
      - /volume1/docker/labstock/data:/app/data
      - /volume1/docker/labstock/uploads:/app/uploads
      - /volume1/docker/labstock/backups:/app/backups

    environment:
      NODE_ENV: production
      PORT: 3000

      DATABASE_URL: file:/app/data/labstock.db

      UPLOAD_DIR: /app/uploads
      BACKUP_DIR: /app/backups

      SESSION_SECRET: change-this-to-a-long-random-value
      SESSION_COOKIE_SECURE: "false"
      SESSION_COOKIE_SAMESITE: lax

      TRUST_PROXY: "true"

      PUID: 1000
      PGID: 1000

    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 40s
```

For a generic Linux server, replace `/volume1/docker/labstock/...` with `/opt/labstock/...` or local relative paths such as `./data`.

Do not add a custom `command` for migrations or permissions. The Docker image entrypoint creates writable directories and runs `prisma migrate deploy` automatically on every start.

**Step 3 — Start**

```bash
docker compose up -d
```

**Step 4 — Open** `http://localhost:3120`

On first launch you will be redirected to the Setup Wizard to create an admin account.

#### Synology NAS (Container Manager)

1. Open **Container Manager → Projects → Create**
2. Upload or paste your `docker-compose.yml`
3. Start the project

To update the image:

```bash
docker compose pull && docker compose up -d
```

---

### Option B — Manual Installation

**Requirements:** Node.js 20+, Git

```bash
# 1. Clone the repository
git clone https://github.com/neightgar/labstock.git
cd labstock

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set SESSION_SECRET at minimum

# 4. Apply database migrations
npm run db:migrate

# 5a. Development mode (auto-reload)
npm run dev

# 5b. Production mode via PM2
npm install -g pm2
pm2 start src/server.js --name labstock
pm2 save && pm2 startup
```

Open `http://localhost:3000`

---

## Configuration

All configuration is done via environment variables (`.env`):

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `DATABASE_URL` | SQLite file path | `file:/app/data/labstock.db` |
| `SESSION_SECRET` | Session signing secret (required) | 32-char random string |
| `PORT` | Server port (optional) | `3000` |
| `BACKUP_DIR` | Backup directory (optional) | `./backups` |
| `UPLOAD_DIR` | Upload directory (optional) | `./uploads` |
| `SESSION_COOKIE_SECURE` | Use secure cookies: `false` for direct HTTP, `auto`/`true` behind HTTPS reverse proxy | `false` |
| `SESSION_COOKIE_SAMESITE` | Session SameSite policy | `lax` |
| `TRUST_PROXY` | Trust reverse proxy headers | `true` |
| `PUID` / `PGID` | UID/GID used for mounted file ownership | `1000` |

> **Telegram Bot** is configured through the admin panel at `/admin` — no `.env` variables needed.

---

## First Run

1. Open `http://your-host:3120`
2. **Setup Wizard** — create the first administrator account
3. Go to `/admin` → create Workspaces and invite users
4. Go to `/admin` → configure Telegram Bot (optional)

---

## REST API

- **Swagger UI:** `http://your-host/api/docs`
- **Authentication:** `X-API-Key` request header
- **API Key:** generate in your profile at `/profile`

All endpoints support filtering, sorting, and pagination. See Swagger for the full schema.

---

## Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Paste the token in `/admin` → Telegram Bot section
3. Enable the bot and save
4. Each user sends `/start` to the bot and enters their username to link the account

**Commands:**

| Command | Description |
|---------|-------------|
| `/low` | Items below minimum stock |
| `/expiring` | Items expiring within 30 days |
| `/search <query>` | Full-text search |
| `/orders` | Current order list |
| `/help` | List of commands |

---

## License

[MIT](LICENSE)
