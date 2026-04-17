const ExcelJS = require("exceljs");

function fmtDate(dt) {
  if (!dt) return "";
  return new Date(dt).toISOString().slice(0, 10);
}

// ── Column definitions ────────────────────────────────────

const REAGENT_COLS = [
  "ID", "Название (RU)", "Название (EN)", "CAS", "Формула",
  "Производитель", "Кат. номер", "Поставщик", "Артикул поставщика",
  "Количество", "Ед.", "Мин. кол-во",
  "Место хранения", "Срок годности", "Дата получения", "Примечания",
];

const CONSUMABLE_COLS = [
  "ID", "Название (RU)", "Название (EN)", "Тип", "Производитель",
  "Кат. номер", "Поставщик", "Артикул поставщика",
  "Количество", "Ед.", "Мин. кол-во", "Место хранения",
  "Размер", "Стерильный", "Материал", "Объём", "Лот",
  "Срок годности", "Примечания",
];

const EQUIPMENT_COLS = [
  "ID", "Название (RU)", "Название (EN)", "Модель", "Производитель",
  "Поставщик", "Артикул поставщика",
  "Серийный номер", "Место хранения", "Статус", "Примечания",
];

function reagentRows(items) {
  return items.map((r) => [
    r.id, r.nameRu, r.nameEn, r.casNumber || "", r.formula || "",
    r.manufacturer?.name || "", r.catalogNumber || "",
    r.supplier?.name || "", r.supplierCatalogNumber || "",
    r.quantity, r.unit, r.minQuantity ?? "",
    r.location?.nameRu || "", fmtDate(r.expiryDate), fmtDate(r.receivedDate), r.notes || "",
  ]);
}

function consumableRows(items) {
  return items.map((c) => [
    c.id, c.nameRu, c.nameEn,
    c.type?.nameRu || "", c.manufacturer?.name || "",
    c.catalogNumber || "", c.supplier?.name || "", c.supplierCatalogNumber || "",
    c.quantity, c.unit, c.minQuantity ?? "",
    c.location?.nameRu || "", c.size || "",
    c.sterile ? "Да" : "Нет", c.material || "", c.volume ?? "",
    c.lotNumber || "", fmtDate(c.expiryDate), c.notes || "",
  ]);
}

function equipmentRows(items) {
  const STATUS_RU = { WORKING: "Рабочее", REPAIR: "Ремонт", DECOMMISSIONED: "Списано" };
  return items.map((e) => [
    e.id, e.nameRu, e.nameEn, e.model || "",
    e.manufacturer?.name || "", e.supplier?.name || "", e.supplierCatalogNumber || "",
    e.serialNumber || "",
    e.location?.nameRu || "", STATUS_RU[e.status] || e.status, e.notes || "",
  ]);
}

function getCols(entityType) {
  if (entityType === "reagent")    return REAGENT_COLS;
  if (entityType === "consumable") return CONSUMABLE_COLS;
  return EQUIPMENT_COLS;
}

function getRows(entityType, items) {
  if (entityType === "reagent")    return reagentRows(items);
  if (entityType === "consumable") return consumableRows(items);
  return equipmentRows(items);
}

// ── Export to XLSX ────────────────────────────────────────

async function exportToXlsx(items, entityType) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LabStock";
  const ws = wb.addWorksheet(entityType);

  const cols = getCols(entityType);
  const headerRow = ws.addRow(cols);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEFF6FF" },
  };

  getRows(entityType, items).forEach((row) => ws.addRow(row));

  // Auto-width (approximate)
  ws.columns.forEach((col, i) => {
    const maxLen = Math.max(cols[i].length, 10);
    col.width = Math.min(maxLen + 4, 40);
  });

  return wb.xlsx.writeBuffer();
}

// ── Export to CSV ─────────────────────────────────────────

function exportToCsv(items, entityType) {
  const cols = getCols(entityType);
  const rows = getRows(entityType, items);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.map(esc).join(",")];
  rows.forEach((r) => lines.push(r.map(esc).join(",")));
  return "\ufeff" + lines.join("\r\n"); // BOM for Excel
}

// ── Import template (headers only) ───────────────────────

async function exportTemplate(entityType) {
  return exportToXlsx([], entityType);
}

module.exports = { exportToXlsx, exportToCsv, exportTemplate };
