const express = require("express");
const bcrypt  = require("bcrypt");
const prisma  = require("../utils/prisma");
const { requireAdmin } = require("../middleware/auth");
const { logAudit }     = require("../middleware/audit");
const { getSetting, setSetting, invalidateSettingsCache } = require("../services/settings");
const {
  startTelegramBotPolling,
  stopTelegramBotPolling,
  isBotPolling,
} = require("../services/telegramBot");

const router = express.Router();
const SALT_ROUNDS = process.env.NODE_ENV === "production" ? 12 : 10;

// All /admin routes require admin role
router.use(requireAdmin);

// ── Helpers ───────────────────────────────────────────────

async function loadAdminData() {
  const [users, workspaces, botToken, botActive] = await Promise.all([
    prisma.user.findMany({ orderBy: { id: "asc" } }),
    prisma.workspace.findMany({
      orderBy: { id: "asc" },
      include: {
        _count: {
          select: {
            members:     true,
            reagents:    true,
            consumables: true,
            equipment:   true,
            protocols:   true,
            orderItems:  true,
          },
        },
      },
    }),
    getSetting("BOT_TOKEN"),
    getSetting("BOT_ACTIVE"),
  ]);
  return { users, workspaces, botToken, botActive };
}

async function loadUserFormRefs() {
  return prisma.workspace.findMany({ orderBy: { nameRu: "asc" } });
}

/** Sync workspace_members for a user. workspaceIds is an array of numbers (may be empty). */
async function syncUserWorkspaces(userId, workspaceIds) {
  const ids = Array.isArray(workspaceIds) ? workspaceIds.map(Number).filter(Boolean) : [];
  // Delete all existing memberships then recreate
  await prisma.workspaceMember.deleteMany({ where: { userId } });
  if (ids.length) {
    await prisma.workspaceMember.createMany({
      data: ids.map((wid) => ({ userId, workspaceId: wid })),
    });
  }
}

// ── GET /admin ────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { users, workspaces, botToken, botActive } = await loadAdminData();

  res.render("admin/index", {
    users,
    workspaces,
    botToken:  botToken  || "",
    botActive: botActive === "true",
    botRunning: isBotPolling(),
    success: req.query.success || null,
    error:   req.query.error   || null,
  });
});

// ── GET /admin/users/new ─────────────────────────────────
router.get("/users/new", async (req, res) => {
  const workspaces = await loadUserFormRefs();
  res.render("admin/user-form", {
    mode: "new",
    user: null,
    userWorkspaceIds: [],
    workspaces,
    error: null,
  });
});

// ── POST /admin/users ─────────────────────────────────────
router.post("/users", async (req, res) => {
  const { username, displayName, password, role, language } = req.body || {};
  const workspaces = await loadUserFormRefs();

  if (!username?.trim() || !displayName?.trim() || !password) {
    return res.render("admin/user-form", {
      mode: "new",
      user: req.body,
      userWorkspaceIds: [],
      workspaces,
      error: res.locals.t("admin.error.requiredFields"),
    });
  }

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) {
    return res.render("admin/user-form", {
      mode: "new",
      user: req.body,
      userWorkspaceIds: [],
      workspaces,
      error: res.locals.t("auth.register.error"),
    });
  }

  const finalRole = ["admin", "user"].includes(role) ? role : "user";
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const newUser = await prisma.user.create({
    data: {
      username:    username.trim(),
      displayName: displayName.trim(),
      passwordHash,
      role:     finalRole,
      language: ["ru", "en"].includes(language) ? language : "ru",
    },
  });

  // Assign workspaces (only relevant for non-admin users)
  if (finalRole !== "admin") {
    const wsIds = req.body.workspaceIds;
    await syncUserWorkspaces(newUser.id, Array.isArray(wsIds) ? wsIds : wsIds ? [wsIds] : []);
  }

  await logAudit(req.user.id, "user", newUser.id, "CREATE", { username: newUser.username, role: newUser.role });

  res.redirect("/admin?success=created");
});

// ── GET /admin/users/:id/edit ─────────────────────────────
router.get("/users/:id/edit", async (req, res) => {
  const id = parseInt(req.params.id);
  const [user, workspaces, memberships] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    loadUserFormRefs(),
    prisma.workspaceMember.findMany({ where: { userId: id } }),
  ]);
  if (!user) return res.redirect("/admin");

  const userWorkspaceIds = memberships.map((m) => m.workspaceId);
  res.render("admin/user-form", { mode: "edit", user, workspaces, userWorkspaceIds, error: null });
});

// ── POST /admin/users/:id/update ─────────────────────────
router.post("/users/:id/update", async (req, res) => {
  const id = parseInt(req.params.id);
  const { displayName, role, language } = req.body || {};

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.redirect("/admin");

  const data = {};
  if (displayName?.trim()) data.displayName = displayName.trim();
  if (["admin", "user"].includes(role))    data.role     = role;
  if (["ru", "en"].includes(language))     data.language = language;

  await prisma.user.update({ where: { id }, data });

  // Sync workspace memberships
  const finalRole = data.role || target.role;
  if (finalRole !== "admin") {
    const wsIds = req.body.workspaceIds;
    await syncUserWorkspaces(id, Array.isArray(wsIds) ? wsIds : wsIds ? [wsIds] : []);
  } else {
    // Admins have no workspace memberships
    await prisma.workspaceMember.deleteMany({ where: { userId: id } });
  }

  await logAudit(req.user.id, "user", id, "UPDATE", data);

  res.redirect("/admin?success=updated");
});

// ── POST /admin/users/:id/delete ─────────────────────────
router.post("/users/:id/delete", async (req, res) => {
  const id = parseInt(req.params.id);

  if (id === req.user.id) {
    return res.redirect("/admin?error=self_delete");
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.redirect("/admin");

  await prisma.user.delete({ where: { id } });
  await logAudit(req.user.id, "user", id, "DELETE", { username: target.username });

  res.redirect("/admin?success=deleted");
});

// ── POST /admin/users/:id/reset-password ─────────────────
router.post("/users/:id/reset-password", async (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword } = req.body || {};

  if (!newPassword || newPassword.length < 4) {
    return res.redirect(`/admin/users/${id}/edit?error=weak_password`);
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.redirect("/admin");

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  await logAudit(req.user.id, "user", id, "RESET_PASSWORD", { target: target.username });

  res.redirect("/admin?success=password_reset");
});

// ── POST /admin/workspaces  (create) ─────────────────────
router.post("/workspaces", async (req, res) => {
  const nameRu = req.body.nameRu?.trim();
  const nameEn = req.body.nameEn?.trim() || nameRu;

  if (!nameRu) return res.redirect("/admin?error=ws_name_required");

  const ws = await prisma.workspace.create({ data: { nameRu, nameEn } });
  await logAudit(req.user.id, "workspace", ws.id, "CREATE", { nameRu });

  res.redirect("/admin?success=ws_created");
});

// ── POST /admin/workspaces/:id/update ────────────────────
router.post("/workspaces/:id/update", async (req, res) => {
  const id = parseInt(req.params.id);
  const nameRu = req.body.nameRu?.trim();
  const nameEn = req.body.nameEn?.trim() || nameRu;

  if (!nameRu) return res.redirect("/admin?error=ws_name_required");

  await prisma.workspace.update({ where: { id }, data: { nameRu, nameEn } });
  await logAudit(req.user.id, "workspace", id, "UPDATE", { nameRu });

  res.redirect("/admin?success=ws_updated");
});

// ── POST /admin/workspaces/:id/delete ────────────────────
router.post("/workspaces/:id/delete", async (req, res) => {
  const id = parseInt(req.params.id);

  if (id === 1) return res.redirect("/admin?error=ws_default_delete");

  try {
    await prisma.workspace.delete({ where: { id } });
    await logAudit(req.user.id, "workspace", id, "DELETE", null);
    res.redirect("/admin?success=ws_deleted");
  } catch (err) {
    // Foreign key constraint — workspace still has records
    res.redirect("/admin?error=ws_not_empty");
  }
});

// ── POST /admin/bot ───────────────────────────────────────
router.post("/bot", async (req, res) => {
  const { botToken, botActive } = req.body || {};
  const isActive = botActive === "1" || botActive === "true";

  try {
    await setSetting("BOT_TOKEN",  botToken?.trim() || "");
    await setSetting("BOT_ACTIVE", isActive ? "true" : "false");
    invalidateSettingsCache();

    // Restart bot with new settings
    stopTelegramBotPolling();
    if (isActive && botToken?.trim()) {
      await startTelegramBotPolling();
    }

    res.redirect("/admin?success=bot_saved");
  } catch (err) {
    console.error("[admin] bot settings save failed:", err);
    res.redirect("/admin?error=bot_save_failed");
  }
});

module.exports = router;
