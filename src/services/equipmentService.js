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

const VALID_STATUSES = ["WORKING", "REPAIR", "DECOMMISSIONED"];

// ── Workspace helpers ─────────────────────────────────────

function wsWhere(user) {
  if (!user) return {};
  if (user.role === "admin") {
    return user.activeWorkspaceId ? { workspaceId: user.activeWorkspaceId } : {};
  }
  return { workspaceId: user.activeWorkspaceId ?? -1 };
}

function assertAccess(item, user) {
  if (!item) return;
  if (!user || user.role === "admin") return;
  if (item.workspaceId !== user.activeWorkspaceId) {
    const err = new Error("Access denied");
    err.status = 403;
    throw err;
  }
}

function resolveWorkspaceId(data, user) {
  if (!user || user.role === "admin") return data.workspaceId ?? 1;
  return user.activeWorkspaceId ?? 1;
}

// ── findMany ──────────────────────────────────────────────

async function findMany({
  page = 1, limit = 30,
  search = "",
  locationId, manufacturerId, status,
} = {}, user = null) {
  const where = { deletedAt: null, ...wsWhere(user) };

  if (search) {
    where.OR = [
      { nameRu: { contains: search } },
      { nameEn: { contains: search } },
      { model: { contains: search } },
      { serialNumber: { contains: search } },
    ];
  }
  if (locationId)     where.locationId     = parseInt(locationId);
  if (manufacturerId) where.manufacturerId = parseInt(manufacturerId);
  if (status && VALID_STATUSES.includes(status)) where.status = status;

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.equipment.count({ where }),
    prisma.equipment.findMany({
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
  const item = await prisma.equipment.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE_FULL,
  });
  assertAccess(item, user);
  return item;
}

// ── create ────────────────────────────────────────────────

async function create(data, user = null) {
  const payload = { ...data, workspaceId: resolveWorkspaceId(data, user) };
  return prisma.equipment.create({ data: payload, include: INCLUDE });
}

// ── update ────────────────────────────────────────────────

async function update(id, data, user = null) {
  await findById(id, user);
  return prisma.equipment.update({ where: { id }, data, include: INCLUDE });
}

// ── softDelete ────────────────────────────────────────────

async function softDelete(id, user = null) {
  await findById(id, user);
  return prisma.equipment.update({ where: { id }, data: { deletedAt: new Date() } });
}

async function restore(id) {
  return prisma.equipment.update({ where: { id }, data: { deletedAt: null } });
}

async function forceDelete(id) {
  return prisma.equipment.delete({ where: { id } });
}

async function findDeleted(user = null) {
  const where = { deletedAt: { not: null }, ...wsWhere(user) };
  return prisma.equipment.findMany({
    where,
    include: INCLUDE,
    orderBy: { deletedAt: "desc" },
  });
}

async function findAllRaw(filters = {}, user = null) {
  const where = { deletedAt: null, ...wsWhere(user) };
  if (filters.search) {
    where.OR = [{ nameRu: { contains: filters.search } }, { nameEn: { contains: filters.search } }];
  }
  if (filters.locationId)     where.locationId     = parseInt(filters.locationId);
  if (filters.manufacturerId) where.manufacturerId = parseInt(filters.manufacturerId);
  if (filters.status && VALID_STATUSES.includes(filters.status)) where.status = filters.status;

  return prisma.equipment.findMany({
    where,
    include: INCLUDE,
    orderBy: { nameRu: "asc" },
  });
}

module.exports = {
  findMany, findById, create, update,
  softDelete, restore, forceDelete,
  findDeleted, findAllRaw,
  VALID_STATUSES,
};
