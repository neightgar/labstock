const prisma = require("../utils/prisma");

async function injectLocals(req, res, next) {
  try {
    res.locals.suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  } catch {
    res.locals.suppliers = [];
  }
  next();
}

module.exports = { injectLocals };
