/**
 * @swagger
 * tags:
 *   name: References
 *   description: Lookup tables — locations, manufacturers, item types
 */

const express = require("express");
const prisma = require("../../../utils/prisma");
const { logAudit } = require("../../../middleware/audit");
const { ok, err, parseId } = require("./_helpers");

// ── Locations ─────────────────────────────────────────────

const locationsRouter = express.Router();

/**
 * @swagger
 * /locations:
 *   get:
 *     summary: List all locations
 *     tags: [References]
 *     responses:
 *       200:
 *         description: Array of locations
 */
locationsRouter.get("/", async (req, res, next) => {
  try {
    const items = await prisma.location.findMany({ orderBy: { nameRu: "asc" } });
    res.json(ok(items));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /locations:
 *   post:
 *     summary: Create location
 *     tags: [References]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameRu, nameEn]
 *             properties:
 *               nameRu: { type: string }
 *               nameEn: { type: string }
 *     responses:
 *       201:
 *         description: Created location
 */
locationsRouter.post("/", async (req, res, next) => {
  try {
    const nameRu = req.body?.nameRu?.trim();
    const nameEn = req.body?.nameEn?.trim();
    if (!nameRu || !nameEn)
      return res.status(400).json(err("VALIDATION_ERROR", "nameRu and nameEn are required"));
    const item = await prisma.location.create({ data: { nameRu, nameEn } });
    await logAudit(req.apiUserId, "location", item.id, "CREATE", { nameRu, nameEn });
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /locations/{id}:
 *   put:
 *     summary: Update location
 *     tags: [References]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Updated location
 */
locationsRouter.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const data = {};
    if (req.body?.nameRu) data.nameRu = req.body.nameRu.trim();
    if (req.body?.nameEn) data.nameEn = req.body.nameEn.trim();
    if (Object.keys(data).length === 0)
      return res.status(400).json(err("VALIDATION_ERROR", "nameRu or nameEn required"));
    const item = await prisma.location.update({ where: { id }, data });
    await logAudit(req.apiUserId, "location", id, "UPDATE", data);
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /locations/{id}:
 *   delete:
 *     summary: Delete location
 *     tags: [References]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
locationsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    await prisma.location.delete({ where: { id } });
    await logAudit(req.apiUserId, "location", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

// ── Manufacturers ─────────────────────────────────────────

const manufacturersRouter = express.Router();

/**
 * @swagger
 * /manufacturers:
 *   get:
 *     summary: List all manufacturers
 *     tags: [References]
 *     responses:
 *       200:
 *         description: Array of manufacturers
 */
manufacturersRouter.get("/", async (req, res, next) => {
  try {
    const items = await prisma.manufacturer.findMany({ orderBy: { name: "asc" } });
    res.json(ok(items));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /manufacturers:
 *   post:
 *     summary: Create manufacturer
 *     tags: [References]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Created manufacturer
 */
manufacturersRouter.post("/", async (req, res, next) => {
  try {
    const name = req.body?.name?.trim();
    if (!name)
      return res.status(400).json(err("VALIDATION_ERROR", "name is required"));
    const item = await prisma.manufacturer.create({ data: { name } });
    await logAudit(req.apiUserId, "manufacturer", item.id, "CREATE", { name });
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /manufacturers/{id}:
 *   put:
 *     summary: Update manufacturer
 *     tags: [References]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Updated manufacturer
 */
manufacturersRouter.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const name = req.body?.name?.trim();
    if (!name) return res.status(400).json(err("VALIDATION_ERROR", "name is required"));
    const item = await prisma.manufacturer.update({ where: { id }, data: { name } });
    await logAudit(req.apiUserId, "manufacturer", id, "UPDATE", { name });
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /manufacturers/{id}:
 *   delete:
 *     summary: Delete manufacturer
 *     tags: [References]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
manufacturersRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    await prisma.manufacturer.delete({ where: { id } });
    await logAudit(req.apiUserId, "manufacturer", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

// ── Item Types ────────────────────────────────────────────

const itemTypesRouter = express.Router();

/**
 * @swagger
 * /item-types:
 *   get:
 *     summary: List all item types
 *     tags: [References]
 *     responses:
 *       200:
 *         description: Array of item types
 */
itemTypesRouter.get("/", async (req, res, next) => {
  try {
    const items = await prisma.itemType.findMany({ orderBy: { nameRu: "asc" } });
    res.json(ok(items));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /item-types:
 *   post:
 *     summary: Create item type
 *     tags: [References]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameRu, nameEn, category]
 *             properties:
 *               nameRu:   { type: string }
 *               nameEn:   { type: string }
 *               category:
 *                 type: string
 *                 enum: [consumable, glassware]
 *     responses:
 *       201:
 *         description: Created item type
 */
itemTypesRouter.post("/", async (req, res, next) => {
  try {
    const nameRu   = req.body?.nameRu?.trim();
    const nameEn   = req.body?.nameEn?.trim();
    const category = req.body?.category?.trim();
    if (!nameRu || !nameEn || !category)
      return res.status(400).json(err("VALIDATION_ERROR", "nameRu, nameEn, category are required"));
    if (!["consumable", "glassware"].includes(category))
      return res.status(400).json(err("VALIDATION_ERROR", "category must be consumable or glassware"));
    const item = await prisma.itemType.create({ data: { nameRu, nameEn, category } });
    await logAudit(req.apiUserId, "item_type", item.id, "CREATE", { nameRu, nameEn });
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /item-types/{id}:
 *   put:
 *     summary: Update item type
 *     tags: [References]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Updated item type
 */
itemTypesRouter.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const data = {};
    if (req.body?.nameRu)   data.nameRu   = req.body.nameRu.trim();
    if (req.body?.nameEn)   data.nameEn   = req.body.nameEn.trim();
    if (req.body?.category) data.category = req.body.category.trim();
    if (Object.keys(data).length === 0)
      return res.status(400).json(err("VALIDATION_ERROR", "At least one field required"));
    const item = await prisma.itemType.update({ where: { id }, data });
    await logAudit(req.apiUserId, "item_type", id, "UPDATE", data);
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /item-types/{id}:
 *   delete:
 *     summary: Delete item type
 *     tags: [References]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
itemTypesRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    await prisma.itemType.delete({ where: { id } });
    await logAudit(req.apiUserId, "item_type", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

module.exports = { locationsRouter, manufacturersRouter, itemTypesRouter };
