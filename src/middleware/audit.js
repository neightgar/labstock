const prisma = require("../utils/prisma");

/**
 * Write a record to audit_logs.
 * Failures are logged but never propagate — audit must not break the main flow.
 */
async function logAudit(userId, entityType, entityId, action, changes) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        entityType,
        entityId,
        action,
        changes: changes ? JSON.stringify(changes) : null,
      },
    });
  } catch (err) {
    console.error("[audit] Write failed:", err.message);
  }
}

module.exports = { logAudit };
