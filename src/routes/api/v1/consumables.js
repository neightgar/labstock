/**
 * @swagger
 * tags:
 *   name: Consumables
 *   description: Consumables and glassware inventory
 */

const express = require("express");
const svc = require("../../../services/consumableService");
const { logAudit } = require("../../../middleware/audit");
const { ok, err, parseId } = require("./_helpers");

const router = express.Router();

function buildPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: { code: "INVALID_BODY", message: "Request body must be a JSON object" } };

  const d = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, "nameRu")) {
    if (typeof body.nameRu !== "string" || !body.nameRu.trim())
      return { error: { code: "VALIDATION_ERROR", message: "nameRu is required" } };
    d.nameRu = body.nameRu.trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "nameEn")) {
    if (typeof body.nameEn !== "string" || !body.nameEn.trim())
      return { error: { code: "VALIDATION_ERROR", message: "nameEn is required" } };
    d.nameEn = body.nameEn.trim();
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "quantity")) {
    const q = parseInt(body.quantity);
    if (isNaN(q)) return { error: { code: "VALIDATION_ERROR", message: "quantity must be an integer" } };
    d.quantity = q;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "unit")) {
    if (typeof body.unit !== "string" || !body.unit.trim())
      return { error: { code: "VALIDATION_ERROR", message: "unit is required" } };
    d.unit = body.unit.trim();
  }

  for (const f of ["catalogNumber", "size", "material", "lotNumber", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(body, f))
      d[f] = body[f]?.toString().trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "minQuantity")) {
    d.minQuantity = body.minQuantity != null && body.minQuantity !== "" ? parseInt(body.minQuantity) : null;
    if (d.minQuantity !== null && isNaN(d.minQuantity))
      return { error: { code: "VALIDATION_ERROR", message: "minQuantity must be a number" } };
  }
  if (Object.prototype.hasOwnProperty.call(body, "volume")) {
    d.volume = body.volume != null && body.volume !== "" ? Number(body.volume) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "sterile"))
    d.sterile = body.sterile === true || body.sterile === "true";
  if (Object.prototype.hasOwnProperty.call(body, "typeId"))
    d.typeId = body.typeId ? parseInt(body.typeId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "locationId"))
    d.locationId = body.locationId ? parseInt(body.locationId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "manufacturerId"))
    d.manufacturerId = body.manufacturerId ? parseInt(body.manufacturerId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "expiryDate"))
    d.expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;

  if (partial && Object.keys(d).length === 0)
    return { error: { code: "VALIDATION_ERROR", message: "At least one field is required" } };

  return { payload: d };
}

/**
 * @swagger
 * /consumables:
 *   get:
 *     summary: List consumables
 *     tags: [Consumables]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: locationId
 *         schema: { type: integer }
 *       - in: query
 *         name: manufacturerId
 *         schema: { type: integer }
 *       - in: query
 *         name: typeId
 *         schema: { type: integer }
 *       - in: query
 *         name: sterile
 *         schema: { type: boolean }
 *       - in: query
 *         name: expiring
 *         schema: { type: boolean }
 *       - in: query
 *         name: lowStock
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Paginated consumables list
 */
router.get("/", async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const { search = "", locationId = "", manufacturerId = "", typeId = "" } = req.query;

    let expiry = "";
    if (req.query.expiring === "true" || req.query.expiring === "1") expiry = "soon";

    const result = await svc.findMany({ page, limit, search, locationId, manufacturerId, typeId, expiry }, req.user);

    let items = result.items;
    if (req.query.sterile === "true" || req.query.sterile === "1")
      items = items.filter((c) => c.sterile);
    if (req.query.lowStock === "true" || req.query.lowStock === "1")
      items = items.filter((c) => c.minQuantity != null && c.quantity <= c.minQuantity);

    res.json(ok(items, { page, limit, total: result.total }));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /consumables/{id}:
 *   get:
 *     summary: Get consumable by ID
 *     tags: [Consumables]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Consumable object
 *       404:
 *         description: Not found
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).json(err("NOT_FOUND", "Consumable not found"));
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /consumables:
 *   post:
 *     summary: Create consumable
 *     tags: [Consumables]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameRu, nameEn, quantity, unit]
 *             properties:
 *               nameRu:         { type: string }
 *               nameEn:         { type: string }
 *               quantity:       { type: integer }
 *               unit:           { type: string }
 *               sterile:        { type: boolean }
 *               typeId:         { type: integer }
 *               manufacturerId: { type: integer }
 *               locationId:     { type: integer }
 *     responses:
 *       201:
 *         description: Created consumable
 */
router.post("/", async (req, res, next) => {
  try {
    const { payload, error } = buildPayload(req.body);
    if (error) return res.status(400).json({ success: false, error });
    const item = await svc.create({ ...payload, createdBy: req.apiUserId }, req.user);
    await logAudit(req.apiUserId, "consumable", item.id, "CREATE", payload);
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /consumables/{id}:
 *   put:
 *     summary: Update consumable
 *     tags: [Consumables]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Updated consumable
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const { payload, error } = buildPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, error });
    const before = await svc.findById(id, req.user);
    if (!before) return res.status(404).json(err("NOT_FOUND", "Consumable not found"));
    const item = await svc.update(id, payload, req.user);
    await logAudit(req.apiUserId, "consumable", id, "UPDATE", { before, after: payload });
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /consumables/{id}:
 *   delete:
 *     summary: Soft-delete consumable
 *     tags: [Consumables]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).json(err("NOT_FOUND", "Consumable not found"));
    await svc.softDelete(id, req.user);
    await logAudit(req.apiUserId, "consumable", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

module.exports = router;
