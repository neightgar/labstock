const prisma = require("../utils/prisma");

const WS_SELECT = { select: { id: true, nameRu: true, nameEn: true } };

const INCLUDE = {
  location: true,
  manufacturer: true,
  workspace: WS_SELECT,
};

const INCLUDE_FULL = {
  location: true,
  manufacturer: true,
  workspace: WS_SELECT,
  creator: { select: { displayName: true } },
};

// ── Workspace helpers ─────────────────────────────────────

/** Build the workspace WHERE clause from user context. */
function wsWhere(user) {
  if (!user) return {};
  if (user.role === "admin") {
    return user.activeWorkspaceId ? { workspaceId: user.activeWorkspaceId } : {};
  }
  return { workspaceId: user.activeWorkspaceId ?? -1 };
}

/** Throw 403 if a regular user tries to access another workspace's record. */
function assertAccess(item, user) {
  if (!item) return;
  if (!user || user.role === "admin") return;
  if (item.workspaceId !== user.activeWorkspaceId) {
    const err = new Error("Access denied");
    err.status = 403;
    throw err;
  }
}

/** Resolve workspaceId for create/update — user's active, or from data for admin. */
function resolveWorkspaceId(data, user) {
  if (!user || user.role === "admin") {
    return data.workspaceId ?? 1;
  }
  return user.activeWorkspaceId ?? 1;
}

// ── findMany ──────────────────────────────────────────────

async function findMany({
  page = 1, limit = 30,
  search = "",
  locationId, manufacturerId,
  expiry,
} = {}, user = null) {
  const where = { deletedAt: null, ...wsWhere(user) };

  if (search) {
    where.OR = [
      { nameRu: { contains: search } },
      { nameEn: { contains: search } },
      { casNumber: { contains: search } },
      { formula: { contains: search } },
    ];
  }
  if (locationId)     where.locationId     = parseInt(locationId);
  if (manufacturerId) where.manufacturerId = parseInt(manufacturerId);

  if (expiry === "expired") {
    where.expiryDate = { not: null, lt: new Date() };
  } else if (expiry === "soon") {
    const limit7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    where.expiryDate = { not: null, lte: limit7 };
  }

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.reagent.count({ where }),
    prisma.reagent.findMany({
      where,
      include: INCLUDE,
      orderBy: { nameRu: "asc" },
      skip,
      take: limit,
    }),
  ]);

  return { items, total, page, pages: Math.ceil(total / limit) || 1 };
}

// ── findById ──────────────────────────────────────────────

async function findById(id, user = null) {
  const item = await prisma.reagent.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE_FULL,
  });
  assertAccess(item, user);
  return item;
}

// ── create ────────────────────────────────────────────────

async function create(data, user = null) {
  const payload = { ...data, workspaceId: resolveWorkspaceId(data, user) };
  return prisma.reagent.create({ data: payload, include: INCLUDE });
}

// ── update ────────────────────────────────────────────────

async function update(id, data, user = null) {
  await findById(id, user); // access check
  return prisma.reagent.update({ where: { id }, data, include: INCLUDE });
}

// ── softDelete ────────────────────────────────────────────

async function softDelete(id, user = null) {
  await findById(id, user); // access check
  return prisma.reagent.update({ where: { id }, data: { deletedAt: new Date() } });
}

async function restore(id) {
  return prisma.reagent.update({ where: { id }, data: { deletedAt: null } });
}

async function forceDelete(id) {
  return prisma.reagent.delete({ where: { id } });
}

async function findDeleted(user = null) {
  const where = { deletedAt: { not: null }, ...wsWhere(user) };
  return prisma.reagent.findMany({
    where,
    include: INCLUDE,
    orderBy: { deletedAt: "desc" },
  });
}

// ── findAllRaw (export) ───────────────────────────────────

async function findAllRaw(filters = {}, user = null) {
  const where = { deletedAt: null, ...wsWhere(user) };
  if (filters.search) {
    where.OR = [
      { nameRu: { contains: filters.search } },
      { nameEn: { contains: filters.search } },
    ];
  }
  if (filters.locationId)     where.locationId     = parseInt(filters.locationId);
  if (filters.manufacturerId) where.manufacturerId = parseInt(filters.manufacturerId);
  if (filters.expiry === "expired") where.expiryDate = { not: null, lt: new Date() };
  if (filters.expiry === "soon")    where.expiryDate = { not: null, lte: new Date(Date.now() + 7 * 86400000) };

  return prisma.reagent.findMany({
    where,
    include: INCLUDE,
    orderBy: { nameRu: "asc" },
  });
}

module.exports = {
  findMany, findById, create, update,
  softDelete, restore, forceDelete,
  findDeleted, findAllRaw,
};
