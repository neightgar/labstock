/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order list management
 */

const express = require("express");
const svc = require("../../../services/orderService");
const { exportToXlsx } = require("../../../services/orderExport");
const { logAudit } = require("../../../middleware/audit");
const { ok, err, parseId } = require("./_helpers");

const router = express.Router();

function buildPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: { code: "INVALID_BODY", message: "Request body must be a JSON object" } };

  const d = {};

  if (typeof body.nameRu !== "string" || !body.nameRu.trim())
    return { error: { code: "VALIDATION_ERROR", message: "nameRu is required" } };
  d.nameRu = body.nameRu.trim();

  if (typeof body.nameEn !== "string" || !body.nameEn.trim())
    return { error: { code: "VALIDATION_ERROR", message: "nameEn is required" } };
  d.nameEn = body.nameEn.trim();

  const entityType = body.entityType;
  if (!["reagent", "consumable", "manual"].includes(entityType))
    return { error: { code: "VALIDATION_ERROR", message: "entityType must be reagent, consumable, or manual" } };
  d.entityType = entityType;

  d.entityId = body.entityId ? parseInt(body.entityId) : null;

  const qty = Number(body.quantity);
  if (isNaN(qty) || qty <= 0)
    return { error: { code: "VALIDATION_ERROR", message: "quantity must be a positive number" } };
  d.quantity = qty;

  if (typeof body.unit !== "string" || !body.unit.trim())
    return { error: { code: "VALIDATION_ERROR", message: "unit is required" } };
  d.unit = body.unit.trim();

  d.manufacturer  = body.manufacturer?.toString().trim()  || null;
  d.catalogNumber = body.catalogNumber?.toString().trim() || null;
  d.notes         = body.notes?.toString().trim()         || null;

  return { payload: d };
}

/**
 * @swagger
 * /orders:
 *   get:
 *     summary: List order items
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated order items list
 */
router.get("/", async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const result = await svc.findAll({ page, limit }, req.user);
    res.json(ok(result.items, { page, limit, total: result.total }));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: Create order item
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nameRu, nameEn, entityType, quantity, unit]
 *             properties:
 *               nameRu:        { type: string }
 *               nameEn:        { type: string }
 *               entityType:
 *                 type: string
 *                 enum: [reagent, consumable, manual]
 *               entityId:      { type: integer }
 *               quantity:      { type: number }
 *               unit:          { type: string }
 *               manufacturer:  { type: string }
 *               catalogNumber: { type: string }
 *               notes:         { type: string }
 *     responses:
 *       201:
 *         description: Created order item
 */
router.post("/", async (req, res, next) => {
  try {
    const { payload, error } = buildPayload(req.body);
    if (error) return res.status(400).json({ success: false, error });
    const item = await svc.create(payload, req.apiUserId, req.user);
    await logAudit(req.apiUserId, "order_item", item.id, "CREATE", payload);
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /orders:
 *   delete:
 *     summary: Delete order items by IDs
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: Deleted count
 */
router.delete("/", async (req, res, next) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json(err("VALIDATION_ERROR", "ids must be a non-empty array"));
    const intIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (intIds.length === 0)
      return res.status(400).json(err("VALIDATION_ERROR", "ids must contain positive integers"));
    const result = await svc.deleteMany(intIds);
    await logAudit(req.apiUserId, "order_item", 0, "DELETE_MANY", { ids: intIds });
    res.json(ok({ deleted: result.count }));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /orders/export:
 *   post:
 *     summary: Export selected order items as XLSX
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: XLSX file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.post("/export", async (req, res, next) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json(err("VALIDATION_ERROR", "ids must be a non-empty array"));
    const intIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const items = await svc.findByIds(intIds);
    const buf = await exportToXlsx(items);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="order_${date}.xlsx"`);
    res.send(buf);
  } catch (e) { next(e); }
});

module.exports = router;
