const express = require("express");
const path = require("path");
const fs = require("fs");
const prisma = require("../utils/prisma");
const svc = require("../services/reagentService");
const { exportToXlsx, exportToCsv, exportTemplate } = require("../services/exportService");
const { importReagents } = require("../services/importService");
const { logAudit } = require("../middleware/audit");
const { upload } = require("../utils/upload");

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

  data.casNumber     = body.casNumber?.trim()     || null;
  data.formula       = body.formula?.trim()       || null;
  data.catalogNumber = body.catalogNumber?.trim() || null;
  data.notes         = body.notes?.trim()         || null;

  const qty = parseFloat(body.quantity);
  if (isNaN(qty)) errors.push("quantity должно быть числом");
  else data.quantity = qty;

  const unit = body.unit?.trim();
  if (!unit) errors.push("unit обязательно");
  else data.unit = unit;

  const minQty = body.minQuantity !== "" && body.minQuantity != null
    ? parseFloat(body.minQuantity) : null;
  if (minQty !== null && isNaN(minQty)) errors.push("minQuantity должно быть числом");
  else data.minQuantity = minQty;

  data.locationId     = body.locationId     ? parseInt(body.locationId)     : null;
  data.manufacturerId = body.manufacturerId ? parseInt(body.manufacturerId) : null;
  data.expiryDate     = body.expiryDate  ? new Date(body.expiryDate)  : null;
  data.receivedDate   = body.receivedDate ? new Date(body.receivedDate) : null;

  if (errors.length) return { error: errors.join("; ") };
  return { data };
}

async function loadRefs() {
  const [locations, manufacturers] = await Promise.all([
    prisma.location.findMany({ orderBy: { nameRu: "asc" } }),
    prisma.manufacturer.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { locations, manufacturers };
}

// ── GET /reagents ─────────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    const { search = "", locationId = "", manufacturerId = "", expiry = "", page = "1" } = req.query;
    const [result, refs] = await Promise.all([
      svc.findMany({ page: Math.max(1, parseInt(page) || 1), limit: 30, search, locationId, manufacturerId, expiry }, req.user),
      loadRefs(),
    ]);
    res.render("reagents/index", { ...result, ...refs, query: req.query });
  } catch (err) { next(err); }
});

// ── GET /reagents/new ─────────────────────────────────────

router.get("/new", async (req, res, next) => {
  try {
    const refs = await loadRefs();
    res.render("reagents/form", { item: null, error: null, ...refs });
  } catch (err) { next(err); }
});

// ── POST /reagents ────────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const { data, error } = buildPayload(req.body);
    const refs = await loadRefs();

    if (error) return res.render("reagents/form", { item: null, error, ...refs });

    const item = await svc.create({ ...data, createdBy: req.user.id }, req.user);
    await logAudit(req.user.id, "reagent", item.id, "CREATE", data);
    res.redirect(`/reagents/${item.id}`);
  } catch (err) { next(err); }
});

// ── GET /reagents/export ──────────────────────────────────

router.get("/export", async (req, res, next) => {
  try {
    const { format = "xlsx", ...filters } = req.query;
    const items = await svc.findAllRaw(filters, req.user);

    if (format === "csv") {
      const csv = exportToCsv(items, "reagent");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="reagents-${Date.now()}.csv"`);
      return res.send(csv);
    }

    const buf = await exportToXlsx(items, "reagent");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="reagents-${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── GET /reagents/template ────────────────────────────────

router.get("/template", async (_req, res, next) => {
  try {
    const buf = await exportTemplate("reagent");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="reagents-template.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── POST /reagents/import ─────────────────────────────────

router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.redirect("/reagents?importError=nofile");
    const workspaceId = req.user.activeWorkspaceId ?? 1;
    const result = await importReagents(req.file.path, req.user.id, workspaceId);
    await logAudit(req.user.id, "reagent", 0, "IMPORT", { created: result.created });
    res.redirect(`/reagents?imported=${result.created}&importErrors=${result.errors.length}`);
  } catch (err) { next(err); }
});

// ── GET /reagents/:id ─────────────────────────────────────

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [item, attachments] = await Promise.all([
      svc.findById(id, req.user),
      prisma.attachment.findMany({ where: { entityType: "reagent", entityId: id }, orderBy: { uploadedAt: "desc" } }),
    ]);
    if (!item) return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    res.render("reagents/show", { item, attachments });
  } catch (err) { next(err); }
});

// ── GET /reagents/:id/edit ────────────────────────────────

router.get("/:id/edit", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [item, refs] = await Promise.all([svc.findById(id, req.user), loadRefs()]);
    if (!item) return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    res.render("reagents/form", { item, error: null, ...refs });
  } catch (err) { next(err); }
});

// ── POST /reagents/:id ────────────────────────────────────

router.post("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { data, error } = buildPayload(req.body);
    const refs = await loadRefs();

    if (error) {
      const item = await svc.findById(id);
      return res.render("reagents/form", { item, error, ...refs });
    }

    const before = await svc.findById(id, req.user);
    const item = await svc.update(id, data, req.user);
    await logAudit(req.user.id, "reagent", id, "UPDATE", { before: before, after: data });
    res.redirect(`/reagents/${item.id}`);
  } catch (err) { next(err); }
});

// ── POST /reagents/:id/delete ─────────────────────────────

router.post("/:id/delete", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await svc.softDelete(id, req.user);
    await logAudit(req.user.id, "reagent", id, "DELETE", null);
    res.redirect("/reagents");
  } catch (err) { next(err); }
});

// ── POST /reagents/:id/attachments ────────────────────────

router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.file) return res.redirect(`/reagents/${id}`);

    await prisma.attachment.create({
      data: {
        filename:   req.file.originalname,
        filepath:   req.file.filename,
        mimeType:   req.file.mimetype,
        entityType: "reagent",
        entityId:   id,
        uploadedBy: req.user.id,
      },
    });
    await logAudit(req.user.id, "reagent", id, "ATTACH", { filename: req.file.originalname });
    res.redirect(`/reagents/${id}`);
  } catch (err) { next(err); }
});

// ── POST /reagents/:id/attachments/:aId/delete ────────────

router.post("/:id/attachments/:aId/delete", async (req, res, next) => {
  try {
    const id  = parseInt(req.params.id);
    const aId = parseInt(req.params.aId);
    const att = await prisma.attachment.findUnique({ where: { id: aId } });
    if (att) {
      const { uploadDir } = require("../utils/upload");
      fs.unlink(path.join(uploadDir, att.filepath), () => {});
      await prisma.attachment.delete({ where: { id: aId } });
      await logAudit(req.user.id, "reagent", id, "DETACH", { filename: att.filename });
    }
    res.redirect(`/reagents/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;
