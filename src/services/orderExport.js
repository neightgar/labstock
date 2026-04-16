const ExcelJS = require("exceljs");

async function exportToXlsx(items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Order");

  ws.columns = [
    { header: "№",             key: "n",             width: 5  },
    { header: "Название",      key: "name",           width: 32 },
    { header: "Кол-во",        key: "quantity",       width: 10 },
    { header: "Ед. изм.",      key: "unit",           width: 10 },
    { header: "Производитель", key: "manufacturer",   width: 22 },
    { header: "Артикул",       key: "catalogNumber",  width: 18 },
    { header: "Комментарий",   key: "notes",          width: 32 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0F0F0" },
  };
  headerRow.commit();

  items.forEach((item, i) => {
    const name =
      item.nameRu +
      (item.nameEn && item.nameEn !== item.nameRu ? ` / ${item.nameEn}` : "");
    ws.addRow({
      n:             i + 1,
      name,
      quantity:      item.quantity,
      unit:          item.unit,
      manufacturer:  item.manufacturer  || "",
      catalogNumber: item.catalogNumber || "",
      notes:         item.notes         || "",
    });
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { exportToXlsx };
