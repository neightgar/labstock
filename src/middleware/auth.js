const prisma = require("../utils/prisma");

// Paths accessible without authentication
const PUBLIC_PATHS = ["/login", "/logout", "/setup", "/health", "/register"];

function isPublicPath(path) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

/**
 * Resolve active workspace for a regular user.
 * From session if valid, otherwise first membership.
 */
function resolveActiveWorkspace(sessionId, workspaces) {
  if (!workspaces || workspaces.length === 0) return null;
  if (sessionId && workspaces.some((w) => w.id === sessionId)) return sessionId;
  return workspaces[0].id;
}

async function requireAuth(req, res, next) {
  if (isPublicPath(req.path)) return next();

  // Valid session → load user with workspace memberships
  if (req.session && req.session.userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.session.userId },
        include: {
          workspaceMembers: { include: { workspace: true }, orderBy: { assignedAt: "asc" } },
        },
      });

      if (user) {
        if (user.role === "admin") {
          // Admin: load all workspaces; allow session-based workspace filter (null = all data)
          user.workspaces = await prisma.workspace.findMany({ orderBy: { id: "asc" } });
          user.activeWorkspaceId = req.session.activeWorkspaceId ?? null;
        } else {
          // Regular user: workspaces from memberships, validate active workspace
          user.workspaces = user.workspaceMembers.map((m) => m.workspace);
          user.activeWorkspaceId = resolveActiveWorkspace(
            req.session.activeWorkspaceId,
            user.workspaces
          );
          // Sync session if the resolved ID differs (e.g. first login)
          if (user.activeWorkspaceId !== req.session.activeWorkspaceId) {
            req.session.activeWorkspaceId = user.activeWorkspaceId;
          }
        }

        req.user = user;
        res.locals.currentUser = user;
        return next();
      }
    } catch (err) {
      console.error("[auth] Failed to load session user:", err);
    }
    // Session invalid — destroy it
    req.session.destroy(() => {});
  }

  // API callers get 401, not a redirect
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Check if setup is needed (no users in DB yet)
  try {
    const count = await prisma.user.count();
    if (count === 0) return res.redirect("/setup");
  } catch (err) {
    console.error("[auth] Failed to count users:", err);
  }

  return res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return res.status(403).render("error", {
      code: 403,
      message: res.locals.t ? res.locals.t("error.403") : "Forbidden",
    });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin, resolveActiveWorkspace };
