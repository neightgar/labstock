/**
 * QR code generation service for LabStock equipment
 */
const QRCode = require("qrcode");

/**
 * Generate QR code as PNG Buffer for an equipment item.
 * The QR encodes the full URL: BASE_URL/equipment/:id
 *
 * @param {number} equipmentId
 * @param {string} baseUrl  - e.g. "http://localhost:3000" or from env
 * @returns {Promise<Buffer>}  PNG image buffer
 */
async function generateQr(equipmentId, baseUrl) {
  const url = `${baseUrl}/equipment/${equipmentId}`;
  const buf = await QRCode.toBuffer(url, {
    type:  "png",
    width: 300,
    margin: 2,
    color: {
      dark:  "#0B1426",   // sidebar-bg colour — distinctive, not plain black
      light: "#FFFFFF",
    },
    errorCorrectionLevel: "M",
  });
  return buf;
}

/**
 * Generate QR code as data URL (base64) — for inline embedding in HTML.
 * @param {number} equipmentId
 * @param {string} baseUrl
 * @returns {Promise<string>}  data:image/png;base64,...
 */
async function generateQrDataUrl(equipmentId, baseUrl) {
  const url = `${baseUrl}/equipment/${equipmentId}`;
  return QRCode.toDataURL(url, {
    width: 200,
    margin: 2,
    color: {
      dark:  "#0B1426",
      light: "#FFFFFF",
    },
    errorCorrectionLevel: "M",
  });
}

module.exports = { generateQr, generateQrDataUrl };
