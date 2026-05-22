const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace("file:", "")
  : "./data/labstock.db";

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const MAX_BACKUPS = 7;
const HASH_FILE = path.join(BACKUP_DIR, ".last_backup_hash");

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

function computeFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(fileBuffer).digest("hex");
}

function getLastBackupHash() {
  try {
    if (fs.existsSync(HASH_FILE)) {
      return fs.readFileSync(HASH_FILE, "utf8").trim();
    }
  } catch (err) {
    console.error("[backup] Failed to read last backup hash:", err.message);
  }
  return null;
}

function saveBackupHash(hash) {
  try {
    fs.writeFileSync(HASH_FILE, hash);
  } catch (err) {
    console.error("[backup] Failed to save backup hash:", err.message);
  }
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

    // Check if database has changed since last backup
    const currentHash = computeFileHash(dbPath);
    const lastHash = getLastBackupHash();

    if (currentHash === lastHash) {
      console.log("[backup] Skipped: no changes detected in database");
      return;
    }

    const filename = `labstock-${formatDate(new Date())}.db`;
    const dest = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(dbPath, dest);
    saveBackupHash(currentHash);
    console.log(`[backup] Created: ${filename}`);

    // Rotate: keep only MAX_BACKUPS most recent backups
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^labstock-.*\.db$/.test(f))
      .map((f) => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        console.log(`[backup] Deleted old backup: ${file.name}`);
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