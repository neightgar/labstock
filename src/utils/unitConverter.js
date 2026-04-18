const GROUPS = {
  mass:   { кг: 1000, г: 1, мг: 0.001, мкг: 0.000001 },
  volume: { л: 1000, мл: 1, мкл: 0.001 },
  pieces: { шт: 1, уп: 1, амп: 1, фл: 1 },
};

function findGroup(unit) {
  const u = unit.toLowerCase().trim();
  for (const [group, units] of Object.entries(GROUPS)) {
    if (u in units) return { group, factor: units[u] };
  }
  return null;
}

/**
 * Parse a change expression like "+ 10 мг", "- 0.5 г", "+100мл", "- 2 уп".
 * Returns { sign: +1|-1, value: number, unit: string } or null if invalid.
 */
function parseChange(input) {
  if (!input) return null;
  const m = input.trim().match(/^([+\-])\s*(\d+(?:[.,]\d+)?)\s*([а-яёА-ЯЁa-zA-Z]+)$/);
  if (!m) return null;
  const sign  = m[1] === "+" ? 1 : -1;
  const value = parseFloat(m[2].replace(",", "."));
  const unit  = m[3].toLowerCase().trim();
  if (isNaN(value) || value <= 0) return null;
  return { sign, value, unit };
}

/**
 * Apply a signed change to currentQty.
 * changeValue is pre-signed (sign * value from parseChange).
 * Throws a string message on incompatible units or negative result.
 */
function applyChange(currentQty, currentUnit, changeValue, changeUnit) {
  const cur = findGroup(currentUnit);
  const chg = findGroup(changeUnit);

  if (!cur || !chg) throw new Error("Неизвестная единица измерения");
  if (cur.group !== chg.group) throw new Error("Несовместимые единицы измерения");

  if (cur.group === "pieces") {
    const result = currentQty + changeValue;
    if (result < 0) throw new Error("Количество не может быть отрицательным");
    return parseFloat(result.toFixed(6));
  }

  const newBase = currentQty * cur.factor + changeValue * chg.factor;
  if (newBase < 0) throw new Error("Количество не может быть отрицательным");
  return parseFloat((newBase / cur.factor).toFixed(6));
}

module.exports = { parseChange, applyChange };
