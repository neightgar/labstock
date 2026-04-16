const express = require("express");
const path    = require("path");
const fs      = require("fs");
const prisma  = require("../utils/prisma");
const svc     = require("../services/protocolService");
const { logAudit } = require("../middleware/audit");
const { upload }   = require("../utils/upload");

const router = express.Router();

// ── Payload builder ───────────────────────────────────────

function buildPayload(body) {
  const errors = [];
  const data = {};

  const titleRu = body.titleRu?.trim();
  if (!titleRu) errors.push("titleRu обязательно");
  else data.titleRu = titleRu;

  const titleEn = body.titleEn?.trim();
  if (!titleEn) errors.push("titleEn обязательно");
  else data.titleEn = titleEn;

  // contentRu / contentEn come from hidden inputs populated by Quill
  data.contentRu = body.contentRu?.trim() || "";
  data.contentEn = body.contentEn?.trim() || "";
  data.category  = body.category?.trim()  || null;
  data.notes     = body.notes?.trim()     || null;

  // Items JSON
  let items = [];
  if (body.itemsJson) {
    try {
      const raw = JSON.parse(body.itemsJson);
      if (Array.isArray(raw)) {
        items = raw.map((it) => ({
          entityType:    String(it.entityType || ""),
          entityId:      parseInt(it.entityId) || 0,
          quantityNeeded: it.quantityNeeded ? parseFloat(it.quantityNeeded) : null,
          unit:          it.unit?.trim() || null,
          notes:         it.notes?.trim() || null,
        })).filter((it) => it.entityType && it.entityId > 0);
      }
    } catch (_) {}
  }
  data.items = items;

  if (errors.length) return { error: errors.join("; ") };
  return { data };
}

// ── GET /protocols/search-items  (JSON, used by form JS) ──

router.get("/search-items", async (req, res, next) => {
  try {
    const q    = (req.query.q || "").trim();
    const type = req.query.type || "all";
    if (!q) return res.json([]);

    const results = [];
    const searchWhere = (extra = {}) => ({
      deletedAt: null,
      ...extra,
      OR: [
        { nameRu: { contains: q, mode: "insensitive" } },
        { nameEn: { contains: q, mode: "insensitive" } },
      ],
    });

    if (type === "all" || type === "reagent") {
      const rows = await prisma.reagent.findMany({
        where: searchWhere(),
        select: { id: true, nameRu: true, nameEn: true, quantity: true, unit: true },
        take: 10,
        orderBy: { nameRu: "asc" },
      });
      rows.forEach((r) => results.push({ ...r, entityType: "reagent" }));
    }

    if (type === "all" || type === "consumable") {
      const rows = await prisma.consumable.findMany({
        where: searchWhere(),
        select: { id: true, nameRu: true, nameEn: true, quantity: true, unit: true },
        take: 10,
        orderBy: { nameRu: "asc" },
      });
      rows.forEach((r) => results.push({ ...r, entityType: "consumable" }));
    }

    if (type === "all" || type === "equipment") {
      const rows = await prisma.equipment.findMany({
        where: searchWhere(),
        select: { id: true, nameRu: true, nameEn: true, status: true },
        take: 10,
        orderBy: { nameRu: "asc" },
      });
      rows.forEach((r) => results.push({ ...r, entityType: "equipment" }));
    }

    res.json(results.slice(0, 20));
  } catch (err) { next(err); }
});

// ── GET /protocols ────────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    const { search = "", category = "", page = "1" } = req.query;
    const [result, categories] = await Promise.all([
      svc.findMany({ page: Math.max(1, parseInt(page) || 1), search, category }, req.user),
      svc.getCategories(req.user),
    ]);
    res.render("protocols/index", { ...result, categories, query: req.query });
  } catch (err) { next(err); }
});

// ── GET /protocols/new ────────────────────────────────────

router.get("/new", async (req, res, next) => {
  try {
    const categories = await svc.getCategories(req.user);
    res.render("protocols/form", { item: null, error: null, categories });
  } catch (err) { next(err); }
});

// ── POST /protocols ───────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const { data, error } = buildPayload(req.body);
    if (error) {
      const categories = await svc.getCategories(req.user);
      return res.render("protocols/form", { item: null, error, categories });
    }
    const protocol = await svc.create(data, req.user.id, req.user);
    await logAudit(req.user.id, "protocol", protocol.id, "CREATE", { titleRu: data.titleRu });
    res.redirect(`/protocols/${protocol.id}`);
  } catch (err) { next(err); }
});

// ── GET /protocols/:id/versions/:v ───────────────────────
// (must be before /:id to avoid conflict)

router.get("/:id/versions/:v", async (req, res, next) => {
  try {
    const id  = parseInt(req.params.id);
    const ver = parseInt(req.params.v);
    const [protocol, snapshot] = await Promise.all([
      svc.findById(id, req.user),
      svc.getVersion(id, ver),
    ]);
    if (!protocol || !snapshot) {
      return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    }
    res.render("protocols/version-show", { protocol, snapshot });
  } catch (err) { next(err); }
});

// ── GET /protocols/:id/versions ──────────────────────────

router.get("/:id/versions", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [protocol, versions] = await Promise.all([
      svc.findById(id, req.user),
      svc.getVersions(id),
    ]);
    if (!protocol) {
      return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    }
    res.render("protocols/versions", { protocol, versions });
  } catch (err) { next(err); }
});

// ── GET /protocols/:id/export ─────────────────────────────

router.get("/:id/export", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const protocol = await svc.findById(id, req.user);
    if (!protocol) {
      return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    }
    const itemsWithStock = await svc.getItemsWithStock(protocol.items);
    res.render("protocols/pdf", { protocol, items: itemsWithStock, layout: false });
  } catch (err) { next(err); }
});

// ── GET /protocols/:id ────────────────────────────────────

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [protocol, attachments] = await Promise.all([
      svc.findById(id, req.user),
      prisma.attachment.findMany({
        where: { entityType: "protocol", entityId: id },
        orderBy: { uploadedAt: "desc" },
      }),
    ]);
    if (!protocol) {
      return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    }
    const itemsWithStock = await svc.getItemsWithStock(protocol.items);
    res.render("protocols/show", { protocol, items: itemsWithStock, attachments });
  } catch (err) { next(err); }
});

// ── GET /protocols/:id/edit ───────────────────────────────

router.get("/:id/edit", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const [protocol, categories] = await Promise.all([
      svc.findById(id, req.user),
      svc.getCategories(req.user),
    ]);
    if (!protocol) {
      return res.status(404).render("error", { code: 404, message: res.locals.t("error.404") });
    }
    // Enrich items with entity names for the materials block
    const enrichedItems = await svc.getItemsWithStock(protocol.items);
    res.render("protocols/form", { item: protocol, enrichedItems, error: null, categories });
  } catch (err) { next(err); }
});

// ── POST /protocols/:id  (update) ─────────────────────────

router.post("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { data, error } = buildPayload(req.body);
    if (error) {
      const [protocol, categories] = await Promise.all([svc.findById(id, req.user), svc.getCategories(req.user)]);
      const enrichedItems = await svc.getItemsWithStock(protocol?.items || []);
      return res.render("protocols/form", { item: protocol, enrichedItems, error, categories });
    }
    const protocol = await svc.update(id, data, req.user.id, req.user);
    await logAudit(req.user.id, "protocol", id, "UPDATE", { titleRu: data.titleRu, version: protocol.version });
    res.redirect(`/protocols/${id}`);
  } catch (err) { next(err); }
});

// ── POST /protocols/:id/delete  (soft delete) ─────────────

router.post("/:id/delete", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await svc.softDelete(id, req.user);
    await logAudit(req.user.id, "protocol", id, "DELETE", null);
    res.redirect("/protocols");
  } catch (err) { next(err); }
});

// ── POST /protocols/:id/attachments ──────────────────────

router.post("/:id/attachments", upload.single("file"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.file) return res.redirect(`/protocols/${id}`);
    await prisma.attachment.create({
      data: {
        filename:   req.file.originalname,
        filepath:   req.file.filename,
        mimeType:   req.file.mimetype,
        entityType: "protocol",
        entityId:   id,
        uploadedBy: req.user.id,
      },
    });
    await logAudit(req.user.id, "protocol", id, "ATTACH", { filename: req.file.originalname });
    res.redirect(`/protocols/${id}`);
  } catch (err) { next(err); }
});

// ── POST /protocols/:id/attachments/:aId/delete ───────────

router.post("/:id/attachments/:aId/delete", async (req, res, next) => {
  try {
    const id  = parseInt(req.params.id);
    const aId = parseInt(req.params.aId);
    const att = await prisma.attachment.findUnique({ where: { id: aId } });
    if (att) {
      const { uploadDir } = require("../utils/upload");
      fs.unlink(path.join(uploadDir, att.filepath), () => {});
      await prisma.attachment.delete({ where: { id: aId } });
      await logAudit(req.user.id, "protocol", id, "DETACH", { filename: att.filename });
    }
    res.redirect(`/protocols/${id}`);
  } catch (err) { next(err); }
});

module.exports = router;
