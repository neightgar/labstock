const prisma = require("../utils/prisma");

const INCLUDE = {
  creator: { select: { displayName: true } },
  workspace: { select: { id: true, nameRu: true, nameEn: true } },
};

// ── Workspace helpers ─────────────────────────────────────

function wsWhere(user) {
  if (!user) return {};
  if (user.role === "admin") {
    return user.activeWorkspaceId ? { workspaceId: user.activeWorkspaceId } : {};
  }
  return { workspaceId: user.activeWorkspaceId ?? -1 };
}

function resolveWorkspaceId(data, user) {
  if (!user || user.role === "admin") return data.workspaceId ?? 1;
  return user.activeWorkspaceId ?? 1;
}

// ── create ────────────────────────────────────────────────

async function create(data, userId, user = null) {
  return prisma.orderItem.create({
    data: { ...data, createdBy: userId, workspaceId: resolveWorkspaceId(data, user) },
    include: INCLUDE,
  });
}

// ── findAll ───────────────────────────────────────────────

async function findAll({ page = 1, limit = 50 } = {}, user = null) {
  const where = wsWhere(user);
  const [total, items] = await Promise.all([
    prisma.orderItem.count({ where }),
    prisma.orderItem.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { items, total, page, pages: Math.ceil(total / limit) || 1 };
}

// ── deleteMany ────────────────────────────────────────────

async function deleteMany(ids) {
  return prisma.orderItem.deleteMany({ where: { id: { in: ids } } });
}

// ── findByIds ─────────────────────────────────────────────

async function findByIds(ids) {
  return prisma.orderItem.findMany({
    where: { id: { in: ids } },
    include: INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

// ── count ─────────────────────────────────────────────────

async function count(user = null) {
  return prisma.orderItem.count({ where: wsWhere(user) });
}

module.exports = { create, findAll, deleteMany, findByIds, count };
