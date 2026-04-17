require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const SqliteStore = require("better-sqlite3-session-store")(session);
const { i18nMiddleware } = require("./i18n");
const { requireAuth } = require("./middleware/auth");

const app = express();

// ── Session store (separate SQLite file) ─────────────────
// Use a stable path that works both locally and in Docker.
// In Docker, DATABASE_URL is absolute (file:/app/data/labstock.db) → use its dir.
// In dev, store sessions next to the Prisma-managed DB (prisma/data/).
const _dbUrl = process.env.DATABASE_URL || "file:./prisma/data/labstock.db";
const _dbPath = _dbUrl.replace(/^file:/, "");
const SESSION_DB_DIR = path.isAbsolute(_dbPath)
  ? path.dirname(_dbPath)
  : path.join(__dirname, "..", "prisma", "data");
fs.mkdirSync(SESSION_DB_DIR, { recursive: true });
const sessionDb = new Database(path.join(SESSION_DB_DIR, "sessions.db"));

app.use(
  session({
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ── Body parsing ─────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Static files ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, "..", "public")));

// ── View engine ──────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

// ── i18n ─────────────────────────────────────────────────
app.use(i18nMiddleware);

// ── Health check (public) ────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── API v1 (before session auth — apiAuth handles its own auth) ──
// Docs: GET /api/v1/docs      — Swagger UI (no auth required)
//        GET /api/v1/docs.json — OpenAPI spec (no auth required)
//        All other /api/v1/* — protected by apiAuth middleware
app.use("/api/v1", require("./routes/api/v1/index"));
// Convenience redirect: /api/docs → /api/v1/docs
app.get("/api/docs", (_req, res) => res.redirect(301, "/api/v1/docs"));
app.get("/api/docs.json", (_req, res) => res.redirect(301, "/api/v1/docs.json"));

// ── Auth middleware (whitelists /login, /setup) ──────────
app.use(requireAuth);

// ── Uploaded files (auth-protected static) ───────────────
const { uploadDir } = require("./utils/upload");
app.use("/uploads", express.static(uploadDir));

// ── Routes ───────────────────────────────────────────────
app.use("/", require("./routes/auth"));
app.use("/", require("./routes/dashboard"));
app.use("/search", require("./routes/search"));
app.use("/references",  require("./routes/references"));
app.use("/reagents",    require("./routes/reagents"));
app.use("/consumables", require("./routes/consumables"));
app.use("/equipment",   require("./routes/equipment"));
app.use("/trash",       require("./routes/trash"));
app.use("/orders",      require("./routes/orders"));
app.use("/protocols",   require("./routes/protocols"));
app.use("/admin",       require("./routes/admin"));

// ── Centralized error handler ────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("[error]", err.message);
  console.error(err.stack);

  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: "Internal server error" });
  }
  res.status(500).render("error", { code: 500, message: res.locals.t("error.500") });
});

module.exports = app;
