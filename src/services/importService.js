const ExcelJS = require("exceljs");
const fs = require("fs");
const prisma = require("../utils/prisma");

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toInt(val) {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

async function findOrCreateManufacturer(name) {
  if (!name) return null;
  const n = String(name).trim();
  if (!n) return null;
  const existing = await prisma.manufacturer.findFirst({
    where: { name: { equals: n } },
  });
  if (existing) return existing.id;
  const created = await prisma.manufacturer.create({ data: { name: n } });
  return created.id;
}

async function findOrCreateLocation(nameRu) {
  if (!nameRu) return null;
  const n = String(nameRu).trim();
  if (!n) return null;
  const existing = await prisma.location.findFirst({
    where: { nameRu: { equals: n } },
  });
  if (existing) return existing.id;
  const created = await prisma.location.create({ data: { nameRu: n, nameEn: n } });
  return created.id;
}

async function findOrCreateItemType(nameRu) {
  if (!nameRu) return null;
  const n = String(nameRu).trim();
  if (!n) return null;
  const existing = await prisma.itemType.findFirst({
    where: { nameRu: { equals: n } },
  });
  if (existing) return existing.id;
  const created = await prisma.itemType.create({
    data: { nameRu: n, nameEn: n, category: "consumable" },
  });
  return created.id;
}

/**
 * Import reagents from XLSX.
 * Expected columns (by position, row 1 = headers, skipped):
 * 0: Название (RU), 1: Название (EN), 2: CAS, 3: Формула,
 * 4: Производитель, 5: Кат. номер, 6: Количество, 7: Ед.,
 * 8: Мин. кол-во, 9: Место хранения, 10: Срок годности,
 * 11: Дата получения, 12: Примечания
 */
async function importReagents(filePath, userId, workspaceId = 1) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const imported = [];
  const errors = [];
  let rowIdx = 0;

  ws.eachRow((row, num) => {
    if (num === 1) return; // skip header
    rowIdx++;
    const vals = row.values; // 1-indexed

    const nameRu = String(vals[1] || "").trim();
    const nameEn = String(vals[2] || "").trim();
    const quantity = toFloat(vals[7]);
    const unit = String(vals[8] || "").trim();

    if (!nameRu) { errors.push({ row: num, msg: "Название (RU) обязательно" }); return; }
    if (quantity === null) { errors.push({ row: num, msg: "Количество должно быть числом" }); return; }
    if (!unit) { errors.push({ row: num, msg: "Ед. измерения обязательна" }); return; }

    imported.push({
      nameRu,
      nameEn: nameEn || nameRu,
      casNumber:    String(vals[3] || "").trim() || null,
      formula:      String(vals[4] || "").trim() || null,
      _manufacturer: String(vals[5] || "").trim() || null,
      catalogNumber: String(vals[6] || "").trim() || null,
      quantity,
      unit,
      minQuantity: toFloat(vals[9]),
      _location:   String(vals[10] || "").trim() || null,
      expiryDate:   toDate(vals[11]),
      receivedDate: toDate(vals[12]),
      notes:        String(vals[13] || "").trim() || null,
    });
  });

  // DB inserts
  let created = 0;
  for (const raw of imported) {
    const manufacturerId = await findOrCreateManufacturer(raw._manufacturer);
    const locationId = await findOrCreateLocation(raw._location);
    await prisma.reagent.create({
      data: {
        nameRu: raw.nameRu,
        nameEn: raw.nameEn,
        casNumber: raw.casNumber,
        formula: raw.formula,
        manufacturerId,
        catalogNumber: raw.catalogNumber,
        quantity: raw.quantity,
        unit: raw.unit,
        minQuantity: raw.minQuantity,
        locationId,
        expiryDate: raw.expiryDate,
        receivedDate: raw.receivedDate,
        notes: raw.notes,
        createdBy: userId,
        workspaceId,
      },
    });
    created++;
  }

  fs.unlink(filePath, () => {});
  return { created, errors };
}

/**
 * Import consumables from XLSX.
 * Columns: 0: Название RU, 1: Название EN, 2: Тип, 3: Производитель,
 * 4: Кат. номер, 5: Количество, 6: Ед., 7: Мин. кол-во, 8: Место,
 * 9: Размер, 10: Стерильный (Да/Yes), 11: Материал, 12: Объём,
 * 13: Лот, 14: Срок годности, 15: Примечания
 */
async function importConsumables(filePath, userId, workspaceId = 1) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const imported = [];
  const errors = [];

  ws.eachRow((row, num) => {
    if (num === 1) return;
    const vals = row.values;

    const nameRu = String(vals[1] || "").trim();
    const quantity = toInt(vals[6]);
    const unit = String(vals[7] || "").trim();

    if (!nameRu) { errors.push({ row: num, msg: "Название (RU) обязательно" }); return; }
    if (quantity === null) { errors.push({ row: num, msg: "Количество должно быть целым числом" }); return; }
    if (!unit) { errors.push({ row: num, msg: "Ед. измерения обязательна" }); return; }

    const sterileRaw = String(vals[11] || "").trim().toLowerCase();
    imported.push({
      nameRu,
      nameEn: String(vals[2] || "").trim() || nameRu,
      _type:    String(vals[3] || "").trim() || null,
      _manufacturer: String(vals[4] || "").trim() || null,
      catalogNumber: String(vals[5] || "").trim() || null,
      quantity,
      unit,
      minQuantity: toInt(vals[8]),
      _location:  String(vals[9] || "").trim() || null,
      size:        String(vals[10] || "").trim() || null,
      sterile:     ["да", "yes", "true", "1"].includes(sterileRaw),
      material:    String(vals[12] || "").trim() || null,
      volume:      toFloat(vals[13]),
      lotNumber:   String(vals[14] || "").trim() || null,
      expiryDate:  toDate(vals[15]),
      notes:       String(vals[16] || "").trim() || null,
    });
  });

  let created = 0;
  for (const raw of imported) {
    const typeId = await findOrCreateItemType(raw._type);
    const manufacturerId = await findOrCreateManufacturer(raw._manufacturer);
    const locationId = await findOrCreateLocation(raw._location);
    await prisma.consumable.create({
      data: {
        nameRu: raw.nameRu, nameEn: raw.nameEn,
        typeId, manufacturerId, catalogNumber: raw.catalogNumber,
        quantity: raw.quantity, unit: raw.unit, minQuantity: raw.minQuantity,
        locationId, size: raw.size, sterile: raw.sterile,
        material: raw.material, volume: raw.volume,
        lotNumber: raw.lotNumber, expiryDate: raw.expiryDate,
        notes: raw.notes, createdBy: userId, workspaceId,
      },
    });
    created++;
  }

  fs.unlink(filePath, () => {});
  return { created, errors };
}

/**
 * Import equipment from XLSX.
 * Columns: 0: Название RU, 1: Название EN, 2: Модель, 3: Производитель,
 * 4: Серийный номер, 5: Место, 6: Статус (WORKING/REPAIR/DECOMMISSIONED), 7: Примечания
 */
async function importEquipment(filePath, userId, workspaceId = 1) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const STATUS_MAP = {
    "рабочее": "WORKING", "working": "WORKING",
    "ремонт": "REPAIR", "repair": "REPAIR",
    "списано": "DECOMMISSIONED", "decommissioned": "DECOMMISSIONED",
  };

  const imported = [];
  const errors = [];

  ws.eachRow((row, num) => {
    if (num === 1) return;
    const vals = row.values;

    const nameRu = String(vals[1] || "").trim();
    if (!nameRu) { errors.push({ row: num, msg: "Название (RU) обязательно" }); return; }

    const statusRaw = String(vals[7] || "WORKING").trim().toLowerCase();
    const status = STATUS_MAP[statusRaw] || "WORKING";

    imported.push({
      nameRu,
      nameEn:        String(vals[2] || "").trim() || nameRu,
      model:         String(vals[3] || "").trim() || null,
      _manufacturer: String(vals[4] || "").trim() || null,
      serialNumber:  String(vals[5] || "").trim() || null,
      _location:     String(vals[6] || "").trim() || null,
      status,
      notes:         String(vals[8] || "").trim() || null,
    });
  });

  let created = 0;
  for (const raw of imported) {
    const manufacturerId = await findOrCreateManufacturer(raw._manufacturer);
    const locationId = await findOrCreateLocation(raw._location);
    await prisma.equipment.create({
      data: {
        nameRu: raw.nameRu, nameEn: raw.nameEn,
        model: raw.model, manufacturerId, serialNumber: raw.serialNumber,
        locationId, status: raw.status, notes: raw.notes,
        createdBy: userId, workspaceId,
      },
    });
    created++;
  }

  fs.unlink(filePath, () => {});
  return { created, errors };
}

module.exports = { importReagents, importConsumables, importEquipment };
