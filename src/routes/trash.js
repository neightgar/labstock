const express = require("express");
const reagentSvc    = require("../services/reagentService");
const consumableSvc = require("../services/consumableService");
const equipmentSvc  = require("../services/equipmentService");
const { logAudit } = require("../middleware/audit");

const router = express.Router();

// ── GET /trash ────────────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    const [reagents, consumables, equipment] = await Promise.all([
      reagentSvc.findDeleted(req.user),
      consumableSvc.findDeleted(req.user),
      equipmentSvc.findDeleted(req.user),
    ]);
    res.render("trash", { reagents, consumables, equipment });
  } catch (err) { next(err); }
});

// ── POST /trash/:type/:id/restore ─────────────────────────

router.post("/:type/:id/restore", async (req, res, next) => {
  try {
    const id   = parseInt(req.params.id);
    const type = req.params.type;

    if (type === "reagent")    await reagentSvc.restore(id);
    else if (type === "consumable") await consumableSvc.restore(id);
    else if (type === "equipment")  await equipmentSvc.restore(id);

    await logAudit(req.user.id, type, id, "RESTORE", null);
    res.redirect("/trash");
  } catch (err) { next(err); }
});

// ── POST /trash/:type/:id/force-delete ───────────────────

router.post("/:type/:id/force-delete", async (req, res, next) => {
  try {
    const id   = parseInt(req.params.id);
    const type = req.params.type;

    // Delete attachments first
    const prisma = require("../utils/prisma");
    const { uploadDir } = require("../utils/upload");
    const fs   = require("fs");
    const path = require("path");

    const atts = await prisma.attachment.findMany({ where: { entityType: type, entityId: id } });
    for (const att of atts) {
      fs.unlink(path.join(uploadDir, att.filepath), () => {});
    }
    await prisma.attachment.deleteMany({ where: { entityType: type, entityId: id } });

    if (type === "reagent")         await reagentSvc.forceDelete(id);
    else if (type === "consumable") await consumableSvc.forceDelete(id);
    else if (type === "equipment")  await equipmentSvc.forceDelete(id);

    await logAudit(req.user.id, type, id, "FORCE_DELETE", null);
    res.redirect("/trash");
  } catch (err) { next(err); }
});

module.exports = router;
