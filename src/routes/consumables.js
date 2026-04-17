const express = require("express");
const path = require("path");
const fs = require("fs");
const prisma = require("../utils/prisma");
const svc = require("../services/consumableService");
const { exportToXlsx, exportToCsv, exportTemplate } = require("../services/exportService");
const { importConsumables } = require("../services/importService");
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

  data.catalogNumber         = body.catalogNumber?.trim()         || null;
  data.supplierCatalogNumber = body.supplierCatalogNumber?.trim() || null;
  data.notes                 = body.notes?.trim()                 || null;
  data.size                  = body.size?.trim()                  || null;
  data.material              = body.material?.trim()              || null;
  data.lotNumber             = body.lotNumber?.trim()             || null;
  data.sterile       = body.sterile === "on";

  const qty = parseInt(body.quantity);
  if (isNaN(qty)) errors.push("quantity должно быть целым числом");
  else data.quantity = qty;

  const unit = body.unit?.trim();
  if (!unit) errors.push("unit обязательно");
  else data.unit = unit;

  const minQty = body.minQuantity !== "" && body.minQuantity != null
    ? parseInt(body.minQuantity) : null;
  if (minQty !== null && isNaN(minQty)) errors.push("minQuantity должно быть числом");
  else data.minQuantity = minQty;

  const vol = body.volume !== "" && body.volume != null ? parseFloat(body.volume) : null;
  data.volume = (vol !== null && isNaN(vol)) ? null : vol;

  data.typeId         = body.typeId         ? parseInt(body.typeId)         : null;
  data.locationId     = body.locationId     ? parseInt(body.locationId)     : null;
  data.manufacturerId = body.manufacturerId ? parseInt(body.manufacturerId) : null;
  data.supplierId     = body.supplierId     ? parseInt(body.supplierId)     : null;
  data.expiryDate     = body.expiryDate     ? new Date(body.expiryDate)     : null;

  if (errors.length) return { error: errors.join("; ") };
  return { data };
}

async function loadRefs() {
  const [locations, manufacturers, suppliers, itemTypes] = await Promise.all([
    prisma.location.findMany({ orderBy: { nameRu: "asc" } }),
    prisma.manufacturer.findMany({ orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.itemType.findMany({ orderBy: { nameRu: "asc" } }),
  ]);
  return { locations, manufacturers, suppliers, itemTypes };
}

// ── GET /consumables ──────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    const { search = "", locationId = "", manufacturerId = "", typeId = "", expiry = "", page = "1" } = req.query;
    const [result, refs] = await Promise.all([
      svc.findMany({ page: Math.max(1, parseInt(page) || 1), limit: 30, search, locationId, manufacturerId, typeId, expiry }, req.user),
      loadRefs(),
    ]);
    res.render("consumables/index", { ...result, ...refs, query: req.query });
  } catch (err) { next(err); }
});

// ── GET /consumables/new ──────────────────────────────────

router.get("/new", async (req, res, next) => {
  try {
    const refs = await loadRefs();
    res.render("consumables/form", { item: null, error: null, ...refs });
  } catch (err) { next(err); }
});

// ── POST /consumables ─────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const { data, error } = buildPayload(req.body);
    const refs = await loadRefs();
    if (error) return res.render("consumables/form", { item: null, error, ...refs });
    const item = await svc.create({ ...data, createdBy: req.user.id }, req.user);
    await logAudit(req.user.id, "consumable", item.id, "CREATE", data);
    res.redirect(`/consumables/${item.id}`);
  } catch (err) { next(err); }
});

// ── GET /consumables/export ───────────────────────────────

router.get("/export", async (req, res, next) => {
  try {
    const { format = "xlsx", ...filters } = req.query;
    const items = await svc.findAllRaw(filters, req.user);
    if (format === "csv") {
      const csv = exportToCsv(items, "consumable");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="consumables-${Date.now()}.csv"`);
      return res.send(csv);
    }
    const buf = await exportToXlsx(items, "consumable");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="consumables-${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

router.get("/template", async (_req, res, next) => {
  try {
    const buf = await exportTemplate("consumable");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="consumables-template.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── POST /consumables/import ──────────────────────────────

router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.redirect("/consumables?importError=nofile");
    const result = await importConsumables(req.file.path, req.user.id, req.user.activeWorkspaceId ?? 1);
    await logAudit(req.user.id, "consumable", 0, "IMPORT", { created: result.created });
    res.redirect(`/consumables?imported=${result.created}&importErrors=${result.errors.length}`);
  } catch (err) { next(err); }
});

// ── GET /consumables/:id ──────────────────────────────────

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [item, attachments] = await Promise.all([
      svc.findById(id, req.user),
      prisma.attachment.findMany({ where: { entityType: "consumable", entityId: id }, orderBy: { uploadedAt: "desc" } }),
    ]);
    if (!item) return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    res.render("consumables/show", { item, attachments });
  } catch (err) { next(err); }
});

// ── GET /consumables/:id/edit ─────────────────────────────

router.get("/:id/edit", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [item, refs] = await Promise.all([svc.findById(id, req.user), loadRefs()]);
    if (!item) return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    res.render("consumables/form", { item, error: null, ...refs });
  } catch (err) { next(err); }
});

// ── POST /consumables/:id ─────────────────────────────────

router.post("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { data, error } = buildPayload(req.body);
    const refs = await loadRefs();
    if (error) {
      const item = await svc.findById(id, req.user);
      return res.render("consumables/form", { item, error, ...refs });
    }
    const before = await svc.findById(id, req.user);
    const item = await svc.update(id, data, req.user);
    await logAudit(req.user.id, "consumable", id, "UPDATE", { before, after: data });
    res.redirect(`/consumables/${item.id}`);
  } catch (err) { next(err); }
});

// ── POST /consumables/:id/delete ──────────────────────────

router.post("/:id/delete", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await svc.softDelete(id, req.user);
    await logAudit(req.user.id, "consumable", id, "DELETE", null);
    res.redirect("/consumables");
  } catch (err) { next(err); }
});

// ── Attachments ───────────────────────────────────────────

router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.file) return res.redirect(`/consumables/${id}`);
    await prisma.attachment.create({
      data: {
        filename: req.file.originalname, filepath: req.file.filename,
        mimeType: req.file.mimetype, entityType: "consumable",
        entityId: id, uploadedBy: req.user.id,
      },
    });
    await logAudit(req.user.id, "consumable", id, "ATTACH", { filename: req.file.originalname });
    res.redirect(`/consumables/${id}`);
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
    res.redirect(`/consumables/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;
