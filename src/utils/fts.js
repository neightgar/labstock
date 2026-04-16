/**
 * FTS5 (Full-Text Search) setup for LabStock
 *
 * Creates SQLite FTS5 virtual tables and sync triggers.
 * Called once at server startup via initFts().
 * Safe to call multiple times — uses CREATE IF NOT EXISTS.
 */
const prisma = require("./prisma");

async function initFts() {
  try {
    // ── Create FTS5 virtual tables ──────────────────────

    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS reagents_fts USING fts5(
        id UNINDEXED,
        name_ru,
        name_en,
        cas_number,
        formula,
        notes,
        content='reagents',
        content_rowid='id',
        tokenize='unicode61'
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS consumables_fts USING fts5(
        id UNINDEXED,
        name_ru,
        name_en,
        notes,
        content='consumables',
        content_rowid='id',
        tokenize='unicode61'
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS equipment_fts USING fts5(
        id UNINDEXED,
        name_ru,
        name_en,
        model,
        serial_number,
        notes,
        content='equipment',
        content_rowid='id',
        tokenize='unicode61'
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS protocols_fts USING fts5(
        id UNINDEXED,
        title_ru,
        title_en,
        notes,
        content='protocols',
        content_rowid='id',
        tokenize='unicode61'
      )
    `);

    // ── Create sync triggers — Reagents ─────────────────

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS reagents_fts_insert AFTER INSERT ON reagents BEGIN
        INSERT INTO reagents_fts(rowid, name_ru, name_en, cas_number, formula, notes)
        VALUES (new.id, new.name_ru, new.name_en, new.cas_number, new.formula, new.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS reagents_fts_delete AFTER DELETE ON reagents BEGIN
        INSERT INTO reagents_fts(reagents_fts, rowid, name_ru, name_en, cas_number, formula, notes)
        VALUES ('delete', old.id, old.name_ru, old.name_en, old.cas_number, old.formula, old.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS reagents_fts_update AFTER UPDATE ON reagents BEGIN
        INSERT INTO reagents_fts(reagents_fts, rowid, name_ru, name_en, cas_number, formula, notes)
        VALUES ('delete', old.id, old.name_ru, old.name_en, old.cas_number, old.formula, old.notes);
        INSERT INTO reagents_fts(rowid, name_ru, name_en, cas_number, formula, notes)
        VALUES (new.id, new.name_ru, new.name_en, new.cas_number, new.formula, new.notes);
      END
    `);

    // ── Triggers — Consumables ──────────────────────────

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS consumables_fts_insert AFTER INSERT ON consumables BEGIN
        INSERT INTO consumables_fts(rowid, name_ru, name_en, notes)
        VALUES (new.id, new.name_ru, new.name_en, new.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS consumables_fts_delete AFTER DELETE ON consumables BEGIN
        INSERT INTO consumables_fts(consumables_fts, rowid, name_ru, name_en, notes)
        VALUES ('delete', old.id, old.name_ru, old.name_en, old.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS consumables_fts_update AFTER UPDATE ON consumables BEGIN
        INSERT INTO consumables_fts(consumables_fts, rowid, name_ru, name_en, notes)
        VALUES ('delete', old.id, old.name_ru, old.name_en, old.notes);
        INSERT INTO consumables_fts(rowid, name_ru, name_en, notes)
        VALUES (new.id, new.name_ru, new.name_en, new.notes);
      END
    `);

    // ── Triggers — Equipment ────────────────────────────

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS equipment_fts_insert AFTER INSERT ON equipment BEGIN
        INSERT INTO equipment_fts(rowid, name_ru, name_en, model, serial_number, notes)
        VALUES (new.id, new.name_ru, new.name_en, new.model, new.serial_number, new.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS equipment_fts_delete AFTER DELETE ON equipment BEGIN
        INSERT INTO equipment_fts(equipment_fts, rowid, name_ru, name_en, model, serial_number, notes)
        VALUES ('delete', old.id, old.name_ru, old.name_en, old.model, old.serial_number, old.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS equipment_fts_update AFTER UPDATE ON equipment BEGIN
        INSERT INTO equipment_fts(equipment_fts, rowid, name_ru, name_en, model, serial_number, notes)
        VALUES ('delete', old.id, old.name_ru, old.name_en, old.model, old.serial_number, old.notes);
        INSERT INTO equipment_fts(rowid, name_ru, name_en, model, serial_number, notes)
        VALUES (new.id, new.name_ru, new.name_en, new.model, new.serial_number, new.notes);
      END
    `);

    // ── Triggers — Protocols ────────────────────────────

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS protocols_fts_insert AFTER INSERT ON protocols BEGIN
        INSERT INTO protocols_fts(rowid, title_ru, title_en, notes)
        VALUES (new.id, new.title_ru, new.title_en, new.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS protocols_fts_delete AFTER DELETE ON protocols BEGIN
        INSERT INTO protocols_fts(protocols_fts, rowid, title_ru, title_en, notes)
        VALUES ('delete', old.id, old.title_ru, old.title_en, old.notes);
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS protocols_fts_update AFTER UPDATE ON protocols BEGIN
        INSERT INTO protocols_fts(protocols_fts, rowid, title_ru, title_en, notes)
        VALUES ('delete', old.id, old.title_ru, old.title_en, old.notes);
        INSERT INTO protocols_fts(rowid, title_ru, title_en, notes)
        VALUES (new.id, new.title_ru, new.title_en, new.notes);
      END
    `);

    // ── Populate FTS from existing data (idempotent) ────
    // Use INSERT OR IGNORE to avoid duplicates on restart

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO reagents_fts(rowid, name_ru, name_en, cas_number, formula, notes)
      SELECT id, name_ru, name_en, cas_number, formula, notes FROM reagents WHERE deleted_at IS NULL
    `);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO consumables_fts(rowid, name_ru, name_en, notes)
      SELECT id, name_ru, name_en, notes FROM consumables WHERE deleted_at IS NULL
    `);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO equipment_fts(rowid, name_ru, name_en, model, serial_number, notes)
      SELECT id, name_ru, name_en, model, serial_number, notes FROM equipment WHERE deleted_at IS NULL
    `);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO protocols_fts(rowid, title_ru, title_en, notes)
      SELECT id, title_ru, title_en, notes FROM protocols WHERE deleted_at IS NULL
    `);

    console.log("[fts] FTS5 tables and triggers initialized");
  } catch (err) {
    // FTS5 may not be available in all SQLite builds — fail gracefully
    console.warn("[fts] FTS5 initialization skipped:", err.message);
  }
}

module.exports = { initFts };
