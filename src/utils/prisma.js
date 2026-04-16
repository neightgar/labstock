const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Enable WAL mode for better concurrent read performance
// PRAGMA journal_mode returns a result row, so $queryRawUnsafe is required
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((err) => {
  console.error("Failed to set WAL mode:", err);
});

module.exports = prisma;
