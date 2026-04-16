const prisma = require("../utils/prisma");
const { resolveActiveWorkspace } = require("./auth");

/**
 * API authentication middleware.
 * Accepts: X-API-Key header OR active session cookie.
 * On success: populates req.user (with workspaces) and req.apiUserId.
 *
 * Workspace resolution for API:
 *   - Admin: activeWorkspaceId = null (sees everything)
 *   - User:  ?workspaceId query param (validated) → else first membership
 */
async function apiAuth(req, res, next) {
  let user = null;

  // 1. Try X-API-Key header
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    try {
      user = await prisma.user.findUnique({
        where: { apiKey },
        include: {
          workspaceMembers: { include: { workspace: true }, orderBy: { assignedAt: "asc" } },
        },
      });
    } catch (err) {
      console.error("[apiAuth] DB error:", err.message);
    }
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_API_KEY", message: "Invalid API key" },
      });
    }
  }

  // 2. Try active session
  if (!user && req.session && req.session.userId) {
    try {
      user = await prisma.user.findUnique({
        where: { id: req.session.userId },
        include: {
          workspaceMembers: { include: { workspace: true }, orderBy: { assignedAt: "asc" } },
        },
      });
    } catch (err) {
      console.error("[apiAuth] DB error:", err.message);
    }
  }

  if (!user) {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required. Use X-API-Key header or a valid session." },
    });
  }

  // Attach flat workspace list
  user.workspaces = user.workspaceMembers.map((m) => m.workspace);

  // Resolve active workspace — honour ?workspaceId= query param for API
  let activeWorkspaceId = null;
  if (user.role !== "admin") {
    const reqWsId = req.query.workspaceId ? parseInt(req.query.workspaceId) : null;
    const validReqWs = reqWsId && user.workspaces.some((w) => w.id === reqWsId) ? reqWsId : null;
    activeWorkspaceId = validReqWs ?? resolveActiveWorkspace(null, user.workspaces, user.role);
  }
  user.activeWorkspaceId = activeWorkspaceId;

  req.user      = user;
  req.apiUserId = user.id;
  return next();
}

module.exports = { apiAuth };
