/**
 * Key/value settings store backed by the `settings` table.
 * A lightweight memory cache avoids repeated DB reads on hot paths.
 * The cache is always invalidated on write so reads stay consistent.
 */
const prisma = require("../utils/prisma");

const cache = new Map(); // key → value string
let cacheWarmed = false;

// ── Warm cache on first access ────────────────────────────

async function warmCache() {
  if (cacheWarmed) return;
  try {
    const rows = await prisma.settings.findMany();
    for (const row of rows) {
      cache.set(row.key, row.value);
    }
    cacheWarmed = true;
  } catch (err) {
    console.error("[settings] warmCache failed:", err.message);
  }
}

// ── Public API ────────────────────────────────────────────

async function getSetting(key) {
  await warmCache();
  if (cache.has(key)) return cache.get(key);

  try {
    const row = await prisma.settings.findUnique({ where: { key } });
    const val = row ? row.value : null;
    if (val !== null) cache.set(key, val);
    return val;
  } catch (err) {
    console.error(`[settings] getSetting(${key}) failed:`, err.message);
    return null;
  }
}

async function setSetting(key, value) {
  try {
    if (value === null || value === undefined || value === "") {
      await prisma.settings.deleteMany({ where: { key } });
      cache.delete(key);
    } else {
      const str = String(value);
      await prisma.settings.upsert({
        where:  { key },
        create: { key, value: str },
        update: { value: str },
      });
      cache.set(key, str);
    }
  } catch (err) {
    console.error(`[settings] setSetting(${key}) failed:`, err.message);
    throw err;
  }
}

function invalidateSettingsCache() {
  cache.clear();
  cacheWarmed = false;
}

module.exports = { getSetting, setSetting, invalidateSettingsCache };
