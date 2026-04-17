const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace("file:", "")
  : "./data/labstock.db";

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const RETENTION_DAYS = 30;

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

async function backupDb() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const dbPath = path.resolve(DB_PATH);
    if (!fs.existsSync(dbPath)) {
      console.warn("Backup skipped: database file not found at", dbPath);
      return;
    }

    const filename = `mrb-${formatDate(new Date())}.db`;
    const dest = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(dbPath, dest);
    console.log(`[backup] Created: ${filename}`);

    // Rotate: delete backups older than RETENTION_DAYS
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db"));

    for (const file of files) {
      const filepath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filepath);
        console.log(`[backup] Deleted old backup: ${file}`);
      }
    }
  } catch (err) {
    console.error("[backup] Backup job failed:", err);
  }
}

function startBackupJob() {
  // Run daily at 02:00
  cron.schedule("0 2 * * *", () => {
    backupDb();
  });
  console.log("[backup] Daily backup job scheduled at 02:00");
}

module.exports = { backupDb, startBackupJob };
