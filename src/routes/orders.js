const express = require("express");
const svc = require("../services/orderService");
const { exportToXlsx } = require("../services/orderExport");
const { logAudit } = require("../middleware/audit");

const router = express.Router();

// ── Payload builder ───────────────────────────────────────

function buildPayload(body) {
  const errors = [];
  const data = {};

  const nameRu = body.nameRu?.trim();
  if (!nameRu) errors.push("nameRu required");
  else data.nameRu = nameRu;

  data.nameEn = body.nameEn?.trim() || nameRu || "";

  const qty = parseFloat(body.quantity);
  if (isNaN(qty) || qty <= 0) errors.push("quantity must be a positive number");
  else data.quantity = qty;

  const unit = body.unit?.trim();
  if (!unit) errors.push("unit required");
  else data.unit = unit;

  data.manufacturer    = body.manufacturer?.trim()  || null;
  data.catalogNumber   = body.catalogNumber?.trim() || null;
  data.deliveryDate    = body.deliveryDate ? new Date(body.deliveryDate) : null;
  data.notifyOnOverdue = body.notifyOnOverdue === "on" || body.notifyOnOverdue === true;
  data.notifyEnabled   = body.notifyEnabled  === "on" || body.notifyEnabled  === true;
  data.entityType      = body.entityType?.trim()    || "manual";
  data.entityId        = body.entityId ? parseInt(body.entityId) : null;

  if (errors.length) return { error: errors.join("; ") };
  return { data };
}

// ── GET /orders ───────────────────────────────────────────
router.get("/", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const { items, total, pages } = await svc.findAll({ page }, req.user);
  res.render("orders/index", { items, total, page, pages, query: req.query });
});

// ── POST /orders  (from modal, accepts JSON or redirect) ──
router.post("/", async (req, res) => {
  const { error, data } = buildPayload(req.body);
  if (error) {
    if (req.headers.accept?.includes("application/json")) {
      return res.status(400).json({ ok: false, error });
    }
    return res.redirect("/orders?error=" + encodeURIComponent(error));
  }

  const item = await svc.create(data, req.session.userId, req.user);
  await logAudit(req.session.userId, "order_item", item.id, "CREATE", data);

  if (req.headers.accept?.includes("application/json")) {
    return res.json({ ok: true });
  }
  res.redirect("/orders?added=1");
});

// ── POST /orders/manual  (manual add form) ───────────────
router.post("/manual", async (req, res) => {
  const { error, data } = buildPayload(req.body);
  if (error) return res.redirect("/orders?error=" + encodeURIComponent(error));

  const item = await svc.create(data, req.session.userId, req.user);
  await logAudit(req.session.userId, "order_item", item.id, "CREATE", data);
  res.redirect("/orders?added=1");
});

// ── POST /orders/export ───────────────────────────────────
router.post("/export", async (req, res) => {
  let ids = req.body.ids;
  if (!ids) return res.redirect("/orders");
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(Number).filter(Boolean);

  const items = await svc.findByIds(ids);
  const buf = await exportToXlsx(items);

  const date = new Date().toISOString().slice(0, 10);
  res
    .setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    .setHeader(
      "Content-Disposition",
      `attachment; filename="order_${date}.xlsx"`
    )
    .send(buf);
});

// ── POST /orders/delete ───────────────────────────────────
router.post("/delete", async (req, res) => {
  let ids = req.body.ids;
  if (!ids) return res.redirect("/orders");
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(Number).filter(Boolean);

  await svc.deleteMany(ids);
  await logAudit(req.session.userId, "order_item", 0, "DELETE_MANY", { ids });
  res.redirect("/orders?deleted=" + ids.length);
});

module.exports = router;
