require("dotenv").config();

const fs = require("fs");
const path = require("path");

// Prisma 5+ resolves SQLite relative paths from schema.prisma location (prisma/).
// Do NOT normalize the URL — let Prisma handle resolution natively.
// For Docker, DATABASE_URL is an absolute file: path (file:/app/data/labstock.db).

const app = require("./app");
const prisma = require("./utils/prisma");
const { startBackupJob } = require("./jobs/backupDb");
const { initFts } = require("./utils/fts");
const { startInventoryCheckJob } = require("./jobs/checkInventory");
const { startTelegramBotPolling, stopTelegramBotPolling } = require("./services/telegramBot");

const port = process.env.PORT || 3000;

let server;

async function shutdown(exitCode) {
  console.log("\n[server] Shutting down...");
  stopTelegramBotPolling();
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  await prisma.$disconnect();
  process.exit(exitCode);
}

async function startServer() {
  // Quick connectivity check — will throw if schema is missing
  await prisma.$queryRawUnsafe("SELECT 1");

  // Set up FTS5 virtual tables + triggers (non-blocking)
  initFts().catch((err) => console.warn("[server] FTS init error:", err.message));

  server = app.listen(port, async () => {
    startBackupJob();
    startInventoryCheckJob();
    await startTelegramBotPolling(); // reads BOT_ACTIVE/BOT_TOKEN from Settings table
    console.log(`[server] Listening on http://localhost:${port}`);
  });
}

process.on("SIGINT",  () => shutdown(0).catch((err) => { console.error(err); process.exit(1); }));
process.on("SIGTERM", () => shutdown(0).catch((err) => { console.error(err); process.exit(1); }));
process.on("unhandledRejection", (err) => { console.error("[unhandledRejection]", err); });

startServer().catch(async (err) => {
  console.error("[server] Startup failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
