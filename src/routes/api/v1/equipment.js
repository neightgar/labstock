/**
 * @swagger
 * tags:
 *   name: Equipment
 *   description: Lab equipment inventory
 */

const express = require("express");
const svc = require("../../../services/equipmentService");
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

  for (const f of ["model", "serialNumber", "supplierCatalogNumber", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(body, f))
      d[f] = body[f]?.toString().trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!svc.VALID_STATUSES.includes(body.status))
      return { error: { code: "VALIDATION_ERROR", message: `status must be one of: ${svc.VALID_STATUSES.join(", ")}` } };
    d.status = body.status;
  }
  if (Object.prototype.hasOwnProperty.call(body, "locationId"))
    d.locationId = body.locationId ? parseInt(body.locationId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "manufacturerId"))
    d.manufacturerId = body.manufacturerId ? parseInt(body.manufacturerId) : null;
  if (Object.prototype.hasOwnProperty.call(body, "supplierId"))
    d.supplierId = body.supplierId ? parseInt(body.supplierId) : null;

  if (partial && Object.keys(d).length === 0)
    return { error: { code: "VALIDATION_ERROR", message: "At least one field is required" } };

  return { payload: d };
}

/**
 * @swagger
 * /equipment:
 *   get:
 *     summary: List equipment
 *     tags: [Equipment]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [WORKING, REPAIR, DECOMMISSIONED]
 *     responses:
 *       200:
 *         description: Paginated equipment list
 */
router.get("/", async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const { search = "", locationId = "", manufacturerId = "", status = "" } = req.query;
    const result = await svc.findMany({ page, limit, search, locationId, manufacturerId, status }, req.user);
    res.json(ok(result.items, { page, limit, total: result.total }));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /equipment/{id}:
 *   get:
 *     summary: Get equipment by ID
 *     tags: [Equipment]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Equipment object
 *       404:
 *         description: Not found
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).json(err("NOT_FOUND", "Equipment not found"));
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /equipment:
 *   post:
 *     summary: Create equipment
 *     tags: [Equipment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameRu, nameEn]
 *             properties:
 *               nameRu:         { type: string }
 *               nameEn:         { type: string }
 *               model:          { type: string }
 *               serialNumber:   { type: string }
 *               status:
 *                 type: string
 *                 enum: [WORKING, REPAIR, DECOMMISSIONED]
 *               manufacturerId: { type: integer }
 *               locationId:     { type: integer }
 *               notes:          { type: string }
 *     responses:
 *       201:
 *         description: Created equipment
 */
router.post("/", async (req, res, next) => {
  try {
    const { payload, error } = buildPayload(req.body);
    if (error) return res.status(400).json({ success: false, error });
    const item = await svc.create({ ...payload, createdBy: req.apiUserId }, req.user);
    await logAudit(req.apiUserId, "equipment", item.id, "CREATE", payload);
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /equipment/{id}:
 *   put:
 *     summary: Update equipment
 *     tags: [Equipment]
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
 *         description: Updated equipment
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const { payload, error } = buildPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, error });
    const before = await svc.findById(id, req.user);
    if (!before) return res.status(404).json(err("NOT_FOUND", "Equipment not found"));
    const item = await svc.update(id, payload, req.user);
    await logAudit(req.apiUserId, "equipment", id, "UPDATE", { before, after: payload });
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /equipment/{id}:
 *   delete:
 *     summary: Soft-delete equipment
 *     tags: [Equipment]
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
    if (!item) return res.status(404).json(err("NOT_FOUND", "Equipment not found"));
    await svc.softDelete(id, req.user);
    await logAudit(req.apiUserId, "equipment", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

module.exports = router;
