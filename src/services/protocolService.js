const prisma = require("../utils/prisma");

const CREATOR_SELECT = { select: { id: true, displayName: true } };

const WS_SELECT = { select: { id: true, nameRu: true, nameEn: true } };

const INCLUDE_LIST = {
  creator: CREATOR_SELECT,
  updater: CREATOR_SELECT,
  workspace: WS_SELECT,
};

const INCLUDE_FULL = {
  creator: CREATOR_SELECT,
  updater: CREATOR_SELECT,
  items: { orderBy: { id: "asc" } },
  versions: {
    include: { changer: CREATOR_SELECT },
    orderBy: { version: "desc" },
    take: 1,
  },
};

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

// ── List ──────────────────────────────────────────────────

async function findMany({ page = 1, limit = 20, search = "", category = "" } = {}, user = null) {
  const where = { deletedAt: null, ...wsWhere(user) };

  if (search) {
    where.OR = [
      { titleRu: { contains: search } },
      { titleEn: { contains: search } },
    ];
  }
  if (category) where.category = category;

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.protocol.count({ where }),
    prisma.protocol.findMany({
      where,
      include: INCLUDE_LIST,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
  return { items, total, page, pages: Math.ceil(total / limit) || 1 };
}

// ── Single ────────────────────────────────────────────────

async function findById(id, user = null) {
  const item = await prisma.protocol.findFirst({
    where: { id, deletedAt: null },
    include: INCLUDE_FULL,
  });
  assertAccess(item, user);
  return item;
}

// ── Create ────────────────────────────────────────────────

async function create(data, userId, user = null) {
  const { items: itemsData = [], ...proto } = data;
  const workspaceId = resolveWorkspaceId(data, user);

  const protocol = await prisma.$transaction(async (tx) => {
    const p = await tx.protocol.create({
      data: {
        ...proto,
        workspaceId,
        version:   1,
        createdBy: userId,
        updatedBy: userId,
      },
      include: INCLUDE_FULL,
    });

    if (itemsData.length > 0) {
      await tx.protocolItem.createMany({
        data: itemsData.map((it) => ({ ...it, protocolId: p.id })),
      });
    }

    await tx.protocolVersion.create({
      data: {
        protocolId: p.id,
        version:    1,
        titleRu:    p.titleRu,
        titleEn:    p.titleEn,
        contentRu:  p.contentRu,
        contentEn:  p.contentEn,
        changedBy:  userId,
      },
    });

    return p;
  });

  return protocol;
}

// ── Update ────────────────────────────────────────────────

async function update(id, data, userId, user = null) {
  await findById(id, user); // access check

  const { items: itemsData = [], ...proto } = data;
  const current = await prisma.protocol.findUnique({ where: { id } });
  const newVersion = (current?.version ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.protocolItem.deleteMany({ where: { protocolId: id } });

    await tx.protocol.update({
      where: { id },
      data: { ...proto, updatedBy: userId, version: newVersion },
    });

    if (itemsData.length > 0) {
      await tx.protocolItem.createMany({
        data: itemsData.map((it) => ({ ...it, protocolId: id })),
      });
    }

    await tx.protocolVersion.create({
      data: {
        protocolId: id,
        version:    newVersion,
        titleRu:    proto.titleRu,
        titleEn:    proto.titleEn,
        contentRu:  proto.contentRu,
        contentEn:  proto.contentEn,
        changedBy:  userId,
      },
    });
  });

  return prisma.protocol.findUnique({ where: { id }, include: INCLUDE_FULL });
}

// ── Soft delete ───────────────────────────────────────────

async function softDelete(id, user = null) {
  await findById(id, user); // access check
  return prisma.protocol.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── Versions ──────────────────────────────────────────────

async function getVersions(protocolId) {
  return prisma.protocolVersion.findMany({
    where: { protocolId },
    include: { changer: CREATOR_SELECT },
    orderBy: { version: "desc" },
  });
}

async function getVersion(protocolId, version) {
  return prisma.protocolVersion.findFirst({
    where: { protocolId, version: parseInt(version) },
    include: { changer: CREATOR_SELECT },
  });
}

// ── Stock lookup (for show page indicators) ───────────────

async function getItemsWithStock(items) {
  return Promise.all(
    items.map(async (item) => {
      let entity = null;
      try {
        if (item.entityType === "reagent") {
          entity = await prisma.reagent.findFirst({
            where: { id: item.entityId, deletedAt: null },
            select: { id: true, nameRu: true, nameEn: true, quantity: true, minQuantity: true, unit: true },
          });
        } else if (item.entityType === "consumable") {
          entity = await prisma.consumable.findFirst({
            where: { id: item.entityId, deletedAt: null },
            select: { id: true, nameRu: true, nameEn: true, quantity: true, minQuantity: true, unit: true },
          });
        } else if (item.entityType === "equipment") {
          entity = await prisma.equipment.findFirst({
            where: { id: item.entityId, deletedAt: null },
            select: { id: true, nameRu: true, nameEn: true, status: true },
          });
        }
      } catch (_) {}
      return { ...item, entity };
    })
  );
}

// ── Count (for dashboard) ─────────────────────────────────

async function count(user = null) {
  return prisma.protocol.count({ where: { deletedAt: null, ...wsWhere(user) } });
}

// ── Distinct categories ───────────────────────────────────

async function getCategories(user = null) {
  const rows = await prisma.protocol.findMany({
    where: { deletedAt: null, category: { not: null }, ...wsWhere(user) },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category).filter(Boolean);
}

module.exports = {
  findMany,
  findById,
  create,
  update,
  softDelete,
  getVersions,
  getVersion,
  getItemsWithStock,
  count,
  getCategories,
};
