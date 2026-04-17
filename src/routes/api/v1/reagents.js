/**
 * @swagger
 * tags:
 *   name: Reagents
 *   description: Chemical reagents inventory
 */

const express = require("express");
const svc = require("../../../services/reagentService");
const { logAudit } = require("../../../middleware/audit");
const { ok, err, parseId } = require("./_helpers");

const router = express.Router();

// ── Validation ────────────────────────────────────────────

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

  for (const f of ["casNumber", "formula", "catalogNumber", "supplierCatalogNumber", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(body, f))
      d[f] = body[f]?.toString().trim() || null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "quantity")) {
    const q = Number(body.quantity);
    if (isNaN(q)) return { error: { code: "VALIDATION_ERROR", message: "quantity must be a number" } };
    d.quantity = q;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "unit")) {
    if (typeof body.unit !== "string" || !body.unit.trim())
      return { error: { code: "VALIDATION_ERROR", message: "unit is required" } };
    d.unit = body.unit.trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, "minQuantity")) {
    d.minQuantity = body.minQuantity != null && body.minQuantity !== "" ? Number(body.minQuantity) : null;
    if (d.minQuantity !== null && isNaN(d.minQuantity))
      return { error: { code: "VALIDATION_ERROR", message: "minQuantity must be a number" } };
  }
  if (Object.prototype.hasOwnProperty.call(body, "locationId"))
    d.locationId = body.locationId ? parseInt(body.locationId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "manufacturerId"))
    d.manufacturerId = body.manufacturerId ? parseInt(body.manufacturerId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "supplierId"))
    d.supplierId = body.supplierId ? parseInt(body.supplierId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "expiryDate"))
    d.expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;
  if (Object.prototype.hasOwnProperty.call(body, "receivedDate"))
    d.receivedDate = body.receivedDate ? new Date(body.receivedDate) : null;

  if (partial && Object.keys(d).length === 0)
    return { error: { code: "VALIDATION_ERROR", message: "At least one field is required" } };

  return { payload: d };
}

// ── Routes ────────────────────────────────────────────────

/**
 * @swagger
 * /reagents:
 *   get:
 *     summary: List reagents
 *     tags: [Reagents]
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
 *         name: expiring
 *         schema: { type: boolean }
 *         description: Filter reagents expiring within 7 days
 *       - in: query
 *         name: lowStock
 *         schema: { type: boolean }
 *         description: Filter reagents at or below minimum quantity
 *     responses:
 *       200:
 *         description: Paginated reagents list
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 */
router.get("/", async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const { search = "", locationId = "", manufacturerId = "" } = req.query;

    let expiry = "";
    if (req.query.expiring === "true" || req.query.expiring === "1") expiry = "soon";

    const result = await svc.findMany({ page, limit, search, locationId, manufacturerId, expiry }, req.user);

    // lowStock post-filter (Prisma doesn't support col comparison directly)
    let items = result.items;
    if (req.query.lowStock === "true" || req.query.lowStock === "1") {
      items = items.filter((r) => r.minQuantity != null && r.quantity <= r.minQuantity);
    }

    res.json(ok(items, { page, limit, total: result.total }));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /reagents/{id}:
 *   get:
 *     summary: Get reagent by ID
 *     tags: [Reagents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Reagent object
 *       404:
 *         description: Not found
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).json(err("NOT_FOUND", "Reagent not found"));
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /reagents:
 *   post:
 *     summary: Create reagent
 *     tags: [Reagents]
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
 *               quantity:       { type: number }
 *               unit:           { type: string }
 *               casNumber:      { type: string }
 *               formula:        { type: string }
 *               catalogNumber:  { type: string }
 *               manufacturerId: { type: integer }
 *               locationId:     { type: integer }
 *               minQuantity:    { type: number }
 *               expiryDate:     { type: string, format: date }
 *               receivedDate:   { type: string, format: date }
 *               notes:          { type: string }
 *     responses:
 *       201:
 *         description: Created reagent
 */
router.post("/", async (req, res, next) => {
  try {
    const { payload, error } = buildPayload(req.body);
    if (error) return res.status(400).json({ success: false, error });
    const item = await svc.create({ ...payload, createdBy: req.apiUserId }, req.user);
    await logAudit(req.apiUserId, "reagent", item.id, "CREATE", payload);
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /reagents/{id}:
 *   put:
 *     summary: Update reagent
 *     tags: [Reagents]
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
 *         description: Updated reagent
 *       404:
 *         description: Not found
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const { payload, error } = buildPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, error });
    const before = await svc.findById(id, req.user);
    if (!before) return res.status(404).json(err("NOT_FOUND", "Reagent not found"));
    const item = await svc.update(id, payload, req.user);
    await logAudit(req.apiUserId, "reagent", id, "UPDATE", { before, after: payload });
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /reagents/{id}:
 *   delete:
 *     summary: Soft-delete reagent
 *     tags: [Reagents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).json(err("NOT_FOUND", "Reagent not found"));
    await svc.softDelete(id, req.user);
    await logAudit(req.apiUserId, "reagent", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

module.exports = router;
