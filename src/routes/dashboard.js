const express = require("express");
const prisma = require("../utils/prisma");

const router = express.Router();

const EXPIRY_SOON_DAYS = 30;

// ── GET / ─────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const now       = new Date();
    const soonLimit = new Date(now.getTime() + EXPIRY_SOON_DAYS * 24 * 60 * 60 * 1000);
    const nowIso    = now.toISOString();
    const soonIso   = soonLimit.toISOString();

    const user = req.user;
    const wsId = user?.activeWorkspaceId ?? null;
    const wsFilter = (wsId !== null) ? `AND workspace_id = ${wsId}` : "";
    const wsCountWhere = (wsId !== null)
      ? { deletedAt: null, workspaceId: wsId }
      : { deletedAt: null };
    const wsOrderWhere = (wsId !== null) ? { workspaceId: wsId } : {};

    // ── Counts ─────────────────────────────────────────
    const [reagentCount, consumableCount, equipmentCount, orderCount, protocolCount] =
      await Promise.all([
        prisma.reagent.count({ where: wsCountWhere }),
        prisma.consumable.count({ where: wsCountWhere }),
        prisma.equipment.count({ where: { deletedAt: null, ...wsOrderWhere } }),
        prisma.orderItem.count({ where: wsOrderWhere }),
        prisma.protocol.count({ where: wsCountWhere }),
      ]);

    // ── Low stock items (quantity <= min_quantity) ──────
    const lowStockItems = await prisma.$queryRawUnsafe(`
      SELECT id, name_ru, name_en, quantity, min_quantity, workspace_id, 'reagent' AS entity_type
      FROM reagents
      WHERE deleted_at IS NULL AND min_quantity IS NOT NULL AND quantity <= min_quantity ${wsFilter}
      UNION ALL
      SELECT id, name_ru, name_en, quantity, min_quantity, workspace_id, 'consumable' AS entity_type
      FROM consumables
      WHERE deleted_at IS NULL AND min_quantity IS NOT NULL AND quantity <= min_quantity ${wsFilter}
      ORDER BY name_ru
      LIMIT 50
    `);

    // ── Expired items (expiryDate < today) ──────────────
    const expiredItems = await prisma.$queryRawUnsafe(`
      SELECT id, name_ru, name_en, expiry_date, workspace_id, 'reagent' AS entity_type
      FROM reagents
      WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND expiry_date < ? ${wsFilter}
      UNION ALL
      SELECT id, name_ru, name_en, expiry_date, workspace_id, 'consumable' AS entity_type
      FROM consumables
      WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND expiry_date < ? ${wsFilter}
      ORDER BY expiry_date
      LIMIT 50
    `, nowIso, nowIso);

    // ── Expiring soon (today <= expiryDate <= +30 days) ─
    const expiringSoonItems = await prisma.$queryRawUnsafe(`
      SELECT id, name_ru, name_en, expiry_date, workspace_id, 'reagent' AS entity_type
      FROM reagents
      WHERE deleted_at IS NULL AND expiry_date IS NOT NULL
        AND expiry_date >= ? AND expiry_date <= ? ${wsFilter}
      UNION ALL
      SELECT id, name_ru, name_en, expiry_date, workspace_id, 'consumable' AS entity_type
      FROM consumables
      WHERE deleted_at IS NULL AND expiry_date IS NOT NULL
        AND expiry_date >= ? AND expiry_date <= ? ${wsFilter}
      ORDER BY expiry_date
      LIMIT 50
    `, nowIso, soonIso, nowIso, soonIso);

    // Workspace map for admin "all data" view
    const allWorkspaces = await prisma.workspace.findMany({ orderBy: { id: "asc" } });
    const wsMap = Object.fromEntries(allWorkspaces.map((w) => [w.id, w]));

    // Normalize BigInt ids returned by raw queries
    const normalize = (arr) => arr.map((r) => ({
      ...r,
      id:           Number(r.id),
      quantity:     r.quantity     !== undefined ? Number(r.quantity)     : undefined,
      min_quantity: r.min_quantity !== undefined ? Number(r.min_quantity) : undefined,
      workspace_id: r.workspace_id !== undefined ? Number(r.workspace_id) : null,
    }));

    const isAdminAllData = user?.role === "admin" && !wsId;

    res.render("dashboard", {
      reagentCount,
      consumableCount,
      equipmentCount,
      orderCount,
      protocolCount,
      lowStockItems:     normalize(lowStockItems),
      expiredItems:      normalize(expiredItems),
      expiringSoonItems: normalize(expiringSoonItems),
      isAdminAllData,
      wsMap,
      // Keep legacy counts for backward compat
      lowStock: lowStockItems.length,
      expiring: expiringSoonItems.length + expiredItems.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /lang/:code — language switcher ───────────────────
router.get("/lang/:code", (req, res) => {
  const lang = ["ru", "en"].includes(req.params.code) ? req.params.code : "ru";
  res.cookie("lang", lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  const back = req.headers.referer || "/";
  res.redirect(back);
});

module.exports = router;
