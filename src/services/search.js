/**
 * Global FTS5 search service for LabStock
 * Searches reagents, consumables, equipment, protocols
 */
const prisma = require("../utils/prisma");

/**
 * Search across all FTS5 tables.
 * Returns grouped results: { reagents, consumables, equipment, protocols }
 * Workspace filtering: admin sees all; user sees only their activeWorkspace.
 *
 * @param {string} query  - search string
 * @param {string} lang   - "ru" | "en"
 * @param {object} user   - req.user (with role, activeWorkspaceId)
 * @param {number} limit  - max results per category (default 8)
 */
async function search(query, lang = "ru", user = null, limit = 8) {
  if (!query || query.trim().length < 2) {
    return { reagents: [], consumables: [], equipment: [], protocols: [] };
  }

  const q = query.trim();
  const ftsQuery = escapeFts(q) + "*";

  // Build workspace filter: null = no filter (all data), number = filter to workspace
  const isAdmin = !user || user.role === "admin";
  const wsId    = user?.activeWorkspaceId ?? (isAdmin ? null : -1);

  try {
    const [reagents, consumables, equipment, protocols] = await Promise.all([
      searchReagents(ftsQuery, wsId, limit),
      searchConsumables(ftsQuery, wsId, limit),
      searchEquipment(ftsQuery, wsId, limit),
      searchProtocols(ftsQuery, wsId, limit),
    ]);

    return { reagents, consumables, equipment, protocols };
  } catch (err) {
    if (err.message && err.message.includes("fts")) {
      return searchFallback(q, wsId, limit);
    }
    throw err;
  }
}

// ── FTS helpers ───────────────────────────────────────────

async function searchReagents(ftsQuery, wsId, limit) {
  const wsClause = wsId !== null ? "AND r.workspace_id = ?" : "";
  const params   = wsId !== null ? [ftsQuery, wsId, limit] : [ftsQuery, limit];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id, r.name_ru, r.name_en, r.cas_number, r.formula
     FROM reagents r
     JOIN reagents_fts fts ON r.id = fts.rowid
     WHERE reagents_fts MATCH ? AND r.deleted_at IS NULL ${wsClause}
     ORDER BY rank
     LIMIT ?`,
    ...params
  );
  return rows.map(mapReagent);
}

async function searchConsumables(ftsQuery, wsId, limit) {
  const wsClause = wsId !== null ? "AND c.workspace_id = ?" : "";
  const params   = wsId !== null ? [ftsQuery, wsId, limit] : [ftsQuery, limit];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT c.id, c.name_ru, c.name_en
     FROM consumables c
     JOIN consumables_fts fts ON c.id = fts.rowid
     WHERE consumables_fts MATCH ? AND c.deleted_at IS NULL ${wsClause}
     ORDER BY rank
     LIMIT ?`,
    ...params
  );
  return rows.map(mapConsumable);
}

async function searchEquipment(ftsQuery, wsId, limit) {
  const wsClause = wsId !== null ? "AND e.workspace_id = ?" : "";
  const params   = wsId !== null ? [ftsQuery, wsId, limit] : [ftsQuery, limit];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT e.id, e.name_ru, e.name_en, e.model, e.serial_number
     FROM equipment e
     JOIN equipment_fts fts ON e.id = fts.rowid
     WHERE equipment_fts MATCH ? AND e.deleted_at IS NULL ${wsClause}
     ORDER BY rank
     LIMIT ?`,
    ...params
  );
  return rows.map(mapEquipment);
}

async function searchProtocols(ftsQuery, wsId, limit) {
  const wsClause = wsId !== null ? "AND p.workspace_id = ?" : "";
  const params   = wsId !== null ? [ftsQuery, wsId, limit] : [ftsQuery, limit];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT p.id, p.title_ru, p.title_en, p.category
     FROM protocols p
     JOIN protocols_fts fts ON p.id = fts.rowid
     WHERE protocols_fts MATCH ? AND p.deleted_at IS NULL ${wsClause}
     ORDER BY rank
     LIMIT ?`,
    ...params
  );
  return rows.map(mapProtocol);
}

// ── Fallback: LIKE search ─────────────────────────────────

async function searchFallback(q, wsId, limit) {
  const like = `%${q}%`;
  const wsRFilter = wsId !== null ? "AND workspace_id = ?" : "";
  const wsEFilter = wsId !== null ? "AND workspace_id = ?" : "";

  const buildParams = (base, wsId, limit) =>
    wsId !== null ? [...base, wsId, limit] : [...base, limit];

  const [reagents, consumables, equipment, protocols] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT id, name_ru, name_en, cas_number, formula FROM reagents
       WHERE deleted_at IS NULL AND (name_ru LIKE ? OR name_en LIKE ? OR cas_number LIKE ? OR formula LIKE ?) ${wsRFilter}
       LIMIT ?`,
      ...buildParams([like, like, like, like], wsId, limit)
    ),
    prisma.$queryRawUnsafe(
      `SELECT id, name_ru, name_en FROM consumables
       WHERE deleted_at IS NULL AND (name_ru LIKE ? OR name_en LIKE ?) ${wsRFilter}
       LIMIT ?`,
      ...buildParams([like, like], wsId, limit)
    ),
    prisma.$queryRawUnsafe(
      `SELECT id, name_ru, name_en, model, serial_number FROM equipment
       WHERE deleted_at IS NULL AND (name_ru LIKE ? OR name_en LIKE ? OR model LIKE ?) ${wsEFilter}
       LIMIT ?`,
      ...buildParams([like, like, like], wsId, limit)
    ),
    prisma.$queryRawUnsafe(
      `SELECT id, title_ru, title_en, category FROM protocols
       WHERE deleted_at IS NULL AND (title_ru LIKE ? OR title_en LIKE ?) ${wsRFilter}
       LIMIT ?`,
      ...buildParams([like, like], wsId, limit)
    ),
  ]);

  return {
    reagents:    reagents.map(mapReagent),
    consumables: consumables.map(mapConsumable),
    equipment:   equipment.map(mapEquipment),
    protocols:   protocols.map(mapProtocol),
  };
}

// ── Mappers ───────────────────────────────────────────────

function mapReagent(r) {
  return {
    id:        Number(r.id),
    nameRu:    r.name_ru || "",
    nameEn:    r.name_en || "",
    casNumber: r.cas_number || "",
    formula:   r.formula || "",
  };
}

function mapConsumable(c) {
  return {
    id:    Number(c.id),
    nameRu: c.name_ru || "",
    nameEn: c.name_en || "",
  };
}

function mapEquipment(e) {
  return {
    id:           Number(e.id),
    nameRu:       e.name_ru || "",
    nameEn:       e.name_en || "",
    model:        e.model || "",
    serialNumber: e.serial_number || "",
  };
}

function mapProtocol(p) {
  return {
    id:       Number(p.id),
    titleRu:  p.title_ru || "",
    titleEn:  p.title_en || "",
    category: p.category || "",
  };
}

// ── FTS5 escape ───────────────────────────────────────────

function escapeFts(q) {
  return q.replace(/["^*:\.]/g, " ").trim();
}

module.exports = { search };
