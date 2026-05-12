const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma = require("../utils/prisma");

const router = express.Router();
const SALT_ROUNDS = process.env.NODE_ENV === "production" ? 12 : 10;

// ── GET /login ────────────────────────────────────────────
router.get("/login", async (req, res) => {
  if (req.session?.userId) return res.redirect("/");

  // If no users exist, redirect to setup
  const count = await prisma.user.count();
  if (count === 0) return res.redirect("/setup");

  res.render("auth/login", { error: null });
});

// ── POST /login ───────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.render("auth/login", { error: res.locals.t("auth.login.error") });
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user) {
    return res.render("auth/login", { error: res.locals.t("auth.login.error") });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.render("auth/login", { error: res.locals.t("auth.login.error") });
  }

  req.session.userId = user.id;

  // Set active workspace: first membership for regular users; null for admins
  if (user.role !== "admin") {
    const firstMember = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { assignedAt: "asc" },
    });
    req.session.activeWorkspaceId = firstMember ? firstMember.workspaceId : null;
  } else {
    req.session.activeWorkspaceId = null;
  }

  // Sync language cookie with user preference
  res.cookie("lang", user.language, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });

  req.session.save((err) => {
    if (err) {
      console.error("[login] Failed to save session:", err);
      return res.render("auth/login", { error: res.locals.t("auth.login.error") });
    }
    res.redirect("/");
  });
});

// ── POST /logout ──────────────────────────────────────────
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ── /register — self-registration removed; redirect to login ─
router.get("/register",  (req, res) => res.redirect("/login"));
router.post("/register", (req, res) => res.redirect("/login"));

// ── GET /setup ────────────────────────────────────────────
router.get("/setup", async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) return res.redirect("/login");
  res.render("auth/setup", { error: null });
});

// ── POST /setup ───────────────────────────────────────────
router.post("/setup", async (req, res) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) return res.redirect("/login");

    const { username, displayName, password } = req.body || {};

    if (!username || !displayName || !password) {
      return res.render("auth/setup", { error: "Все поля обязательны" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.create({
      data: { username, displayName, passwordHash, language: "ru", role: "admin" },
    });

    res.redirect("/login");
  } catch (err) {
    console.error("[setup] Failed to create admin:", err);
    res.render("auth/setup", { error: `Ошибка создания пользователя: ${err.message}` });
  }
});

// ── GET /profile ──────────────────────────────────────────
router.get("/profile", async (req, res) => {
  if (!req.user) return res.redirect("/login");
  res.render("auth/profile", { success: null, error: null, newApiKey: null });
});

// ── POST /profile/api-key ─────────────────────────────────
// Generate (or regenerate) an API key for the current user.
// The new key is shown once on the profile page, then only
// its masked form (prefix) is displayed.
router.post("/profile/api-key", async (req, res) => {
  if (!req.user) return res.redirect("/login");

  const apiKey = "mrb_" + crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: req.user.id },
    data: { apiKey },
  });

  // Pass the key once so the template can show it
  res.render("auth/profile", {
    success: res.locals.t("auth.profile.apiKeyGenerated"),
    error: null,
    newApiKey: apiKey,
  });
});

// ── POST /profile ─────────────────────────────────────────
router.post("/profile", async (req, res) => {
  if (!req.user) return res.redirect("/login");

  const { displayName, telegramChatId, language, currentPassword, newPassword } = req.body || {};

  const renderError = (msg) =>
    res.render("auth/profile", { success: null, error: msg, newApiKey: null });
  const renderSuccess = (msg) =>
    res.render("auth/profile", { success: msg, error: null, newApiKey: null });

  // Build update data
  const data = {};
  if (displayName) data.displayName = displayName;
  if (telegramChatId !== undefined) data.telegramChatId = telegramChatId || null;
  if (language && ["ru", "en"].includes(language)) data.language = language;

  // Password change
  if (newPassword) {
    if (!currentPassword) return renderError(res.locals.t("auth.profile.wrongPassword"));
    const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!valid) return renderError(res.locals.t("auth.profile.wrongPassword"));
    data.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  }

  await prisma.user.update({ where: { id: req.user.id }, data });

  // Refresh session user and language cookie
  if (data.language) {
    res.cookie("lang", data.language, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  }

  return renderSuccess(res.locals.t("auth.profile.saved"));
});

// ── POST /workspace/switch ────────────────────────────────
// Switch the active workspace for the current session.
router.post("/workspace/switch", async (req, res) => {
  if (!req.user) return res.redirect("/");

  const raw = req.body.workspaceId;

  if (req.user.role === "admin") {
    // Admin: accept any workspace id or empty string/null for "all data"
    req.session.activeWorkspaceId = raw ? (parseInt(raw) || null) : null;
    return res.redirect(req.headers.referer || "/");
  }

  const newId = parseInt(raw);
  if (!newId) return res.redirect(req.headers.referer || "/");

  // Verify the regular user is a member of this workspace
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: req.user.id, workspaceId: newId } },
  });

  if (member) {
    req.session.activeWorkspaceId = newId;
  }

  res.redirect(req.headers.referer || "/");
});

module.exports = router;
