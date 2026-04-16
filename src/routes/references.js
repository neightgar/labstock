const express = require("express");
const prisma = require("../utils/prisma");

const router = express.Router();

// ── GET /references ───────────────────────────────────────
router.get("/", async (req, res) => {
  const [locations, manufacturers, itemTypes] = await Promise.all([
    prisma.location.findMany({ orderBy: { nameRu: "asc" } }),
    prisma.manufacturer.findMany({ orderBy: { name: "asc" } }),
    prisma.itemType.findMany({ orderBy: { nameRu: "asc" } }),
  ]);

  res.render("references/index", { locations, manufacturers, itemTypes });
});

// ════════════════════════════════════════════════════════
// Locations
// ════════════════════════════════════════════════════════

router.post("/api/locations", async (req, res) => {
  const { nameRu, nameEn } = req.body || {};
  if (!nameRu || !nameEn) return res.status(400).json({ error: "nameRu and nameEn required" });

  const location = await prisma.location.create({ data: { nameRu, nameEn } });
  res.json(location);
});

router.put("/api/locations/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { nameRu, nameEn } = req.body || {};
  if (!nameRu || !nameEn) return res.status(400).json({ error: "nameRu and nameEn required" });

  const location = await prisma.location.update({ where: { id }, data: { nameRu, nameEn } });
  res.json(location);
});

router.delete("/api/locations/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const usageCount = await countLocationUsage(id);
  if (usageCount > 0) {
    return res.status(409).json({ error: res.locals.t("references.inUse") });
  }

  await prisma.location.delete({ where: { id } });
  res.json({ ok: true });
});

async function countLocationUsage(id) {
  const [r, c, e] = await Promise.all([
    prisma.reagent.count({ where: { locationId: id, deletedAt: null } }),
    prisma.consumable.count({ where: { locationId: id, deletedAt: null } }),
    prisma.equipment.count({ where: { locationId: id, deletedAt: null } }),
  ]);
  return r + c + e;
}

// ════════════════════════════════════════════════════════
// Manufacturers
// ════════════════════════════════════════════════════════

router.post("/api/manufacturers", async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const manufacturer = await prisma.manufacturer.create({ data: { name } });
  res.json(manufacturer);
});

router.put("/api/manufacturers/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });

  const manufacturer = await prisma.manufacturer.update({ where: { id }, data: { name } });
  res.json(manufacturer);
});

router.delete("/api/manufacturers/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const usageCount = await countManufacturerUsage(id);
  if (usageCount > 0) {
    return res.status(409).json({ error: res.locals.t("references.inUse") });
  }

  await prisma.manufacturer.delete({ where: { id } });
  res.json({ ok: true });
});

async function countManufacturerUsage(id) {
  const [r, c, e] = await Promise.all([
    prisma.reagent.count({ where: { manufacturerId: id, deletedAt: null } }),
    prisma.consumable.count({ where: { manufacturerId: id, deletedAt: null } }),
    prisma.equipment.count({ where: { manufacturerId: id, deletedAt: null } }),
  ]);
  return r + c + e;
}

// ════════════════════════════════════════════════════════
// Item Types
// ════════════════════════════════════════════════════════

router.post("/api/item-types", async (req, res) => {
  const { nameRu, nameEn, category } = req.body || {};
  if (!nameRu || !nameEn || !category) {
    return res.status(400).json({ error: "nameRu, nameEn, category required" });
  }

  const itemType = await prisma.itemType.create({ data: { nameRu, nameEn, category } });
  res.json(itemType);
});

router.put("/api/item-types/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { nameRu, nameEn, category } = req.body || {};
  if (!nameRu || !nameEn || !category) {
    return res.status(400).json({ error: "nameRu, nameEn, category required" });
  }

  const itemType = await prisma.itemType.update({ where: { id }, data: { nameRu, nameEn, category } });
  res.json(itemType);
});

router.delete("/api/item-types/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const inUse = await prisma.consumable.count({ where: { typeId: id, deletedAt: null } });
  if (inUse > 0) {
    return res.status(409).json({ error: res.locals.t("references.inUse") });
  }

  await prisma.itemType.delete({ where: { id } });
  res.json({ ok: true });
});

module.exports = router;
