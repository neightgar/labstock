/**
 * @swagger
 * tags:
 *   name: Protocols
 *   description: Standard Operating Procedures (SOP)
 */

const express = require("express");
const svc = require("../../../services/protocolService");
const { logAudit } = require("../../../middleware/audit");
const { ok, err, parseId } = require("./_helpers");

const router = express.Router();

function buildPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: { code: "INVALID_BODY", message: "Request body must be a JSON object" } };

  const d = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, "titleRu")) {
    if (typeof body.titleRu !== "string" || !body.titleRu.trim())
      return { error: { code: "VALIDATION_ERROR", message: "titleRu is required" } };
    d.titleRu = body.titleRu.trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "titleEn")) {
    if (typeof body.titleEn !== "string" || !body.titleEn.trim())
      return { error: { code: "VALIDATION_ERROR", message: "titleEn is required" } };
    d.titleEn = body.titleEn.trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "contentRu")) {
    if (typeof body.contentRu !== "string")
      return { error: { code: "VALIDATION_ERROR", message: "contentRu must be a string" } };
    d.contentRu = body.contentRu;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, "contentEn")) {
    if (typeof body.contentEn !== "string")
      return { error: { code: "VALIDATION_ERROR", message: "contentEn must be a string" } };
    d.contentEn = body.contentEn;
  }

  if (Object.prototype.hasOwnProperty.call(body, "category"))
    d.category = body.category?.toString().trim() || null;
  if (Object.prototype.hasOwnProperty.call(body, "notes"))
    d.notes = body.notes?.toString().trim() || null;

  // Protocol items
  if (Object.prototype.hasOwnProperty.call(body, "items")) {
    if (!Array.isArray(body.items))
      return { error: { code: "VALIDATION_ERROR", message: "items must be an array" } };
    d.items = body.items.map((it) => ({
      entityType:     it.entityType,
      entityId:       parseInt(it.entityId),
      quantityNeeded: it.quantityNeeded != null ? Number(it.quantityNeeded) : null,
      unit:           it.unit || null,
      notes:          it.notes || null,
    }));
  }

  if (partial && Object.keys(d).length === 0)
    return { error: { code: "VALIDATION_ERROR", message: "At least one field is required" } };

  return { payload: d };
}

/**
 * @swagger
 * /protocols:
 *   get:
 *     summary: List protocols
 *     tags: [Protocols]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated protocols list
 */
router.get("/", async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { search = "", category = "" } = req.query;
    const result = await svc.findMany({ page, limit, search, category }, req.user);
    res.json(ok(result.items, { page, limit, total: result.total }));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /protocols/{id}:
 *   get:
 *     summary: Get protocol by ID (with items and latest version)
 *     tags: [Protocols]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Protocol object with items and versions
 *       404:
 *         description: Not found
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).json(err("NOT_FOUND", "Protocol not found"));
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /protocols/{id}/versions:
 *   get:
 *     summary: Get version history for a protocol
 *     tags: [Protocols]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Array of protocol versions
 */
router.get("/:id/versions", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const versions = await svc.getVersions(id);
    res.json(ok(versions));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /protocols:
 *   post:
 *     summary: Create protocol
 *     tags: [Protocols]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [titleRu, titleEn, contentRu, contentEn]
 *             properties:
 *               titleRu:   { type: string }
 *               titleEn:   { type: string }
 *               contentRu: { type: string }
 *               contentEn: { type: string }
 *               category:  { type: string }
 *               notes:     { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     entityType:     { type: string }
 *                     entityId:       { type: integer }
 *                     quantityNeeded: { type: number }
 *                     unit:           { type: string }
 *     responses:
 *       201:
 *         description: Created protocol
 */
router.post("/", async (req, res, next) => {
  try {
    const { payload, error } = buildPayload(req.body);
    if (error) return res.status(400).json({ success: false, error });
    const item = await svc.create(payload, req.apiUserId, req.user);
    await logAudit(req.apiUserId, "protocol", item.id, "CREATE", { titleRu: payload.titleRu });
    res.status(201).json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /protocols/{id}:
 *   put:
 *     summary: Update protocol (creates new version)
 *     tags: [Protocols]
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
 *         description: Updated protocol
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json(err("INVALID_ID", "id must be a positive integer"));
    const { payload, error } = buildPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, error });
    const before = await svc.findById(id, req.user);
    if (!before) return res.status(404).json(err("NOT_FOUND", "Protocol not found"));
    const item = await svc.update(id, payload, req.apiUserId, req.user);
    await logAudit(req.apiUserId, "protocol", id, "UPDATE", { version: item.version });
    res.json(ok(item));
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /protocols/{id}:
 *   delete:
 *     summary: Soft-delete protocol
 *     tags: [Protocols]
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
    if (!item) return res.status(404).json(err("NOT_FOUND", "Protocol not found"));
    await svc.softDelete(id, req.user);
    await logAudit(req.apiUserId, "protocol", id, "DELETE", null);
    res.status(204).send();
  } catch (e) { next(e); }
});

module.exports = router;
