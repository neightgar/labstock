// Shared helpers for API v1 routes

function ok(data, meta = undefined) {
  const res = { success: true, data };
  if (meta !== undefined) res.meta = meta;
  return res;
}

function err(code, message) {
  return { success: false, error: { code, message } };
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { ok, err, parseId };
