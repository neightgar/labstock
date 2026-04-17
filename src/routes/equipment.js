const express = require("express");
const path = require("path");
const fs = require("fs");
const prisma = require("../utils/prisma");
const svc = require("../services/equipmentService");
const { exportToXlsx, exportToCsv, exportTemplate } = require("../services/exportService");
const { importEquipment } = require("../services/importService");
const { logAudit } = require("../middleware/audit");
const { upload } = require("../utils/upload");
const { generateQr } = require("../services/qrcode");

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────

function buildPayload(body) {
  const errors = [];
  const data = {};

  const nameRu = body.nameRu?.trim();
  if (!nameRu) errors.push("nameRu обязательно");
  else data.nameRu = nameRu;

  const nameEn = body.nameEn?.trim();
  if (!nameEn) errors.push("nameEn обязательно");
  else data.nameEn = nameEn;

  data.model                 = body.model?.trim()                 || null;
  data.serialNumber          = body.serialNumber?.trim()          || null;
  data.supplierCatalogNumber = body.supplierCatalogNumber?.trim() || null;
  data.notes                 = body.notes?.trim()                 || null;

  data.locationId     = body.locationId     ? parseInt(body.locationId)     : null;
  data.manufacturerId = body.manufacturerId ? parseInt(body.manufacturerId) : null;
  data.supplierId     = body.supplierId     ? parseInt(body.supplierId)     : null;

  const status = body.status;
  if (!svc.VALID_STATUSES.includes(status)) {
    errors.push("status недопустим");
  } else {
    data.status = status;
  }

  if (errors.length) return { error: errors.join("; ") };
  return { data };
}

async function loadRefs() {
  const [locations, manufacturers, suppliers] = await Promise.all([
    prisma.location.findMany({ orderBy: { nameRu: "asc" } }),
    prisma.manufacturer.findMany({ orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { locations, manufacturers, suppliers };
}

// ── GET /equipment ────────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    const { search = "", locationId = "", manufacturerId = "", status = "", page = "1" } = req.query;
    const [result, refs] = await Promise.all([
      svc.findMany({ page: Math.max(1, parseInt(page) || 1), limit: 30, search, locationId, manufacturerId, status }, req.user),
      loadRefs(),
    ]);
    res.render("equipment/index", { ...result, ...refs, query: req.query });
  } catch (err) { next(err); }
});

// ── GET /equipment/new ────────────────────────────────────

router.get("/new", async (req, res, next) => {
  try {
    const refs = await loadRefs();
    res.render("equipment/form", { item: null, error: null, ...refs, VALID_STATUSES: svc.VALID_STATUSES });
  } catch (err) { next(err); }
});

// ── POST /equipment ───────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const { data, error } = buildPayload(req.body);
    const refs = await loadRefs();
    if (error) return res.render("equipment/form", { item: null, error, ...refs, VALID_STATUSES: svc.VALID_STATUSES });
    const item = await svc.create({ ...data, createdBy: req.user.id }, req.user);
    await logAudit(req.user.id, "equipment", item.id, "CREATE", data);
    res.redirect(`/equipment/${item.id}`);
  } catch (err) { next(err); }
});

// ── GET /equipment/export ─────────────────────────────────

router.get("/export", async (req, res, next) => {
  try {
    const { format = "xlsx", ...filters } = req.query;
    const items = await svc.findAllRaw(filters, req.user);
    if (format === "csv") {
      const csv = exportToCsv(items, "equipment");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="equipment-${Date.now()}.csv"`);
      return res.send(csv);
    }
    const buf = await exportToXlsx(items, "equipment");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="equipment-${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

router.get("/template", async (_req, res, next) => {
  try {
    const buf = await exportTemplate("equipment");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="equipment-template.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── POST /equipment/import ────────────────────────────────

router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.redirect("/equipment?importError=nofile");
    const result = await importEquipment(req.file.path, req.user.id, req.user.activeWorkspaceId ?? 1);
    await logAudit(req.user.id, "equipment", 0, "IMPORT", { created: result.created });
    res.redirect(`/equipment?imported=${result.created}&importErrors=${result.errors.length}`);
  } catch (err) { next(err); }
});

// ── GET /equipment/:id/qr — PNG QR code ──────────────────

router.get("/:id/qr", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const item = await svc.findById(id, req.user);
    if (!item) return res.status(404).end();

    const proto   = req.headers["x-forwarded-proto"] || req.protocol;
    const host    = req.headers["x-forwarded-host"]  || req.get("host");
    const baseUrl = `${proto}://${host}`;

    const buf = await generateQr(id, baseUrl);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="qr-equipment-${id}.png"`
    );
    res.send(buf);
  } catch (err) { next(err); }
});

// ── GET /equipment/:id ────────────────────────────────────

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [item, attachments] = await Promise.all([
      svc.findById(id, req.user),
      prisma.attachment.findMany({ where: { entityType: "equipment", entityId: id }, orderBy: { uploadedAt: "desc" } }),
    ]);
    if (!item) return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });

    // Generate QR data URL for inline display
    const proto   = req.headers["x-forwarded-proto"] || req.protocol;
    const host    = req.headers["x-forwarded-host"]  || req.get("host");
    const baseUrl = `${proto}://${host}`;
    let qrDataUrl = null;
    try {
      const { generateQrDataUrl } = require("../services/qrcode");
      qrDataUrl = await generateQrDataUrl(id, baseUrl);
    } catch (_) { /* ignore */ }

    res.render("equipment/show", { item, attachments, qrDataUrl });
  } catch (err) { next(err); }
});

// ── GET /equipment/:id/edit ───────────────────────────────

router.get("/:id/edit", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [item, refs] = await Promise.all([svc.findById(id, req.user), loadRefs()]);
    if (!item) return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    res.render("equipment/form", { item, error: null, ...refs, VALID_STATUSES: svc.VALID_STATUSES });
  } catch (err) { next(err); }
});

// ── POST /equipment/:id ───────────────────────────────────

router.post("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { data, error } = buildPayload(req.body);
    const refs = await loadRefs();
    if (error) {
      const item = await svc.findById(id, req.user);
      return res.render("equipment/form", { item, error, ...refs, VALID_STATUSES: svc.VALID_STATUSES });
    }
    const before = await svc.findById(id, req.user);
    const item = await svc.update(id, data, req.user);
    await logAudit(req.user.id, "equipment", id, "UPDATE", { before, after: data });
    res.redirect(`/equipment/${item.id}`);
  } catch (err) { next(err); }
});

// ── POST /equipment/:id/delete ────────────────────────────

router.post("/:id/delete", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await svc.softDelete(id, req.user);
    await logAudit(req.user.id, "equipment", id, "DELETE", null);
    res.redirect("/equipment");
  } catch (err) { next(err); }
});

// ── Attachments ───────────────────────────────────────────

router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.file) return res.redirect(`/equipment/${id}`);
    await prisma.attachment.create({
      data: {
        filename: req.file.originalname, filepath: req.file.filename,
        mimeType: req.file.mimetype, entityType: "equipment",
        entityId: id, uploadedBy: req.user.id,
      },
    });
    res.redirect(`/equipment/${id}`);
  } catch (err) { next(err); }
});

router.post("/:id/attachments/:aId/delete", async (req, res, next) => {
  try {
    const id  = parseInt(req.params.id);
    const aId = parseInt(req.params.aId);
    const att = await prisma.attachment.findUnique({ where: { id: aId } });
    if (att) {
      const { uploadDir } = require("../utils/upload");
      fs.unlink(path.join(uploadDir, att.filepath), () => {});
      await prisma.attachment.delete({ where: { id: aId } });
    }
    res.redirect(`/equipment/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;
