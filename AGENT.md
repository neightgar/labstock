# AGENT.md

## Project Overview

Lab inventory database (WebUI) for the Molecular Radiobiology Sector, LRB JINR.
Self-hosted on Synology NAS via Docker. Based on the architecture of home-apothecary.

## Working Environment

```
~/Projects/home-apothecary/   ← reference project, read-only, DO NOT MODIFY
~/Projects/LabStock/            ← this project
```

## Priorities

1. Simplicity over abstraction
2. Readability over cleverness
3. Minimal dependencies
4. Docker-first design

## Tech Stack

* Node.js (Express)
* SQLite (file-based, WAL mode)
* Prisma ORM
* EJS (server-rendered web UI)
* TipTap (rich-text editor for protocols)
* bcrypt + express-session (authentication)
* multer (file uploads)
* exceljs (XLSX/CSV export/import)
* cookie-parser (for i18n language persistence)
* node-cron (backups, notifications)

## Architecture Rules

* Layered structure: routes → services → models
* No unnecessary design patterns
* No microservices
* Web UI: EJS + vanilla JS, no frontend frameworks (React, Vue, etc.)
* No TypeScript

## Database Rules

* Use SQLite only, with WAL mode enabled
* Store DB in `/app/data/labstock.db`
* Use Prisma for all DB operations (no raw SQL except FTS5 and PRAGMA)
* All main tables include `deleted_at` for soft delete — always filter with `WHERE deleted_at IS NULL`
* All CUD operations must write to AuditLog

## Reuse Rules (from home-apothecary)

Before writing a file from scratch, check if an analog exists in `~/Projects/home-apothecary/`.

**Copy as-is:**
* `src/i18n.js` → `src/i18n.js` (i18n middleware, universal)
* `src/services/telegram.js` → `src/services/telegram.js` (Phase 7)
* `src/services/botI18n.js` → `src/services/botI18n.js` (Phase 7)

**Adapt (keep structure, change content):**
* `Dockerfile` — add python3/make/g++ for bcrypt, add /app/uploads and /app/backups
* `docker-compose.yml` — change image/port/env, add volumes for uploads/backups
* `package.json` — keep scripts structure, add new deps
* `src/app.js` — keep middleware chain, add session/auth/multer, replace routes
* `src/server.js` — reuse graceful shutdown pattern, add backup cron
* `src/prisma.js` → `src/utils/prisma.js` — add WAL mode pragma
* `src/services/settingsService.js` — keep .env read/write, extend keys
* `src/jobs/checkMedications.js` → `src/jobs/checkInventory.js` + `backupDb.js`

**Use as reference (patterns, not code):**
* `src/services/medicationService.js` — CRUD pattern, extend with soft delete/pagination/filters/audit
* `src/services/telegramBot.js` — polling/connectivity/graceful start-stop
* `src/routes/medicationRoutes.js` — `buildPayload` validation pattern, REST structure
* `src/routes/web.js` — route → service → render EJS pattern
* `views/index.ejs` — JSON initial data in `<script>`, i18n injection, sidebar nav, modal
* `public/styles.css` — CSS tokens/reset/app shell (change color theme to neutral/professional)
* `public/script.js` — client-side state/render/API helpers (split into modules)

## Mandatory Patterns (from home-apothecary)

* **i18n**: `t(lang, key, params)` via middleware, cookie-based language switch
* **Server startup**: graceful shutdown with SIGINT/SIGTERM
* **CRUD service**: `findMany` → `create` → `update` → `delete` via Prisma
* **Payload validation**: `buildPayload(body, { partial })` in routes
* **Client-side state**: JSON initial data in `<script>`, render loop, API helpers
* **Settings**: read/write .env via settingsService

## Internationalization (i18n)

* All UI strings stored in `src/locales/*.json` (ru.json, en.json)
* `src/i18n.js` provides middleware setting `req.lang` from cookie
* EJS templates use `<%= t('key') %>` for translations
* JavaScript frontend reads i18n strings from `<script id="i18n-strings">` tag
* Language switched via header buttons, saved in cookie (`lang`)
* Bot uses `src/services/botI18n.js` with `bt(lang, key)` function

## File Structure

* views/ split into layouts/, partials/, and per-entity folders (not one giant index.ejs)
* public/js/ split into modules per feature (not one script.js)
* src/jobs/ for all cron tasks
* src/middleware/ for auth, i18n, audit

## Error Handling

* Centralized middleware for Express errors
* No unhandled promise rejections
* Frontend validates API responses before mutating state

## Docker Rules

* Must run both locally without Docker and inside Docker without code changes
* Data persists via volumes: /app/data, /app/uploads, /app/backups
* No hardcoded secrets — use `.env` or Portainer env vars
* Synology NAS paths: `/volume1/docker/labstock/`

## What NOT to Do

* Do not modify files in `~/Projects/home-apothecary/`
* Do not use PostgreSQL
* Do not add frontend frameworks (React, Vue, etc.)
* Do not use TypeScript
* Do not overengineer — if home-apothecary does it simply, keep it simple
* Tests are not required at this stage

## Definition of Done

* Feature works via Web UI
* Works in Docker
* Does not break existing functionality
* UI strings are translated (both RU and EN)
* Soft delete and audit log are implemented for all CRUD
* All files referenced in PROJECT_PLAN.md reuse map are checked before writing from scratch
