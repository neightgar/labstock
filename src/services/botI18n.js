const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "..", "locales");

const translations = {};

function loadTranslations() {
  try {
    const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const lang = path.basename(file, ".json");
      const content = fs.readFileSync(path.join(LOCALES_DIR, file), "utf-8");
      translations[lang] = JSON.parse(content);
    }
  } catch (error) {
    console.error("[botI18n] Failed to load translations:", error);
  }
}

loadTranslations();

function bt(lang, key, params = {}) {
  const dict = translations[lang] || translations["ru"] || {};
  let value = dict[key] || key;

  for (const [param, val] of Object.entries(params)) {
    value = value.replace(`{${param}}`, String(val));
  }

  return value;
}

module.exports = { bt };
