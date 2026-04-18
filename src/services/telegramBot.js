const prisma = require("../utils/prisma");
const { sendTelegramMessage } = require("./telegram");
const { getSetting } = require("./settings");
const { bt } = require("./botI18n");
const { search } = require("./search");
const { parseChange, applyChange } = require("../utils/unitConverter");
const { logAudit } = require("../middleware/audit");

const POLLING_INTERVAL_MS = 5000;
const EXPIRY_WINDOW_DAYS  = 30; // /expiring command window
const EDIT_TIMEOUT_MS     = 5 * 60 * 1000; // 5 minutes

const userStates  = new Map(); // chatId -> { step }
const userLangs   = new Map(); // chatId -> lang (cache)
const editSessions = new Map(); // chatId -> edit state

let lastUpdateId    = 0;
let pollingTimer    = null;
let isPolling       = false;
let activeToken     = null; // set by startTelegramBotPolling

// ── Helpers ───────────────────────────────────────────────

function formatDate(date) {
  return new Date(date).toISOString().split("T")[0];
}

async function getUserByChatId(chatId) {
  return prisma.user.findFirst({
    where: { telegramChatId: String(chatId) },
    include: {
      workspaceMembers: { include: { workspace: true }, orderBy: { assignedAt: "asc" } },
    },
  });
}

async function getUserLang(chatId) {
  const cached = userLangs.get(String(chatId));
  if (cached) return cached;
  const user = await getUserByChatId(chatId);
  if (user) {
    userLangs.set(String(chatId), user.language || "ru");
    return user.language || "ru";
  }
  return "ru";
}

function getName(item, lang) {
  return (lang === "en" && item.nameEn) ? item.nameEn : item.nameRu;
}

/** Returns workspace list the user should see. Admin: all workspaces. */
async function getWorkspaces(user) {
  if (user.role === "admin") {
    return prisma.workspace.findMany({ orderBy: { id: "asc" } });
  }
  return (user.workspaceMembers || []).map((m) => m.workspace);
}

/** Build Prisma WHERE clause for workspace filtering. */
function wsBotWhere(workspaces, isAdmin) {
  if (isAdmin) return {};
  const ids = workspaces.map((w) => w.id);
  if (ids.length === 0) return { workspaceId: -1 };
  if (ids.length === 1) return { workspaceId: ids[0] };
  return { workspaceId: { in: ids } };
}

/** Workspace display name in the given lang. */
function wsName(ws, lang) {
  return (lang === "en" && ws.nameEn) ? ws.nameEn : ws.nameRu;
}

/** Group an array of items by workspaceId. */
function groupByWs(items) {
  const map = {};
  for (const item of items) {
    const k = item.workspaceId ?? 0;
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}

// ── Telegram API ──────────────────────────────────────────

async function telegramRequest(method, body) {
  if (!activeToken) return null;

  try {
    const response = await fetch(`https://api.telegram.org/bot${activeToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Telegram] ${method} error: ${response.status} ${text}`);
      return null;
    }
    return response.json();
  } catch (err) {
    console.error(`[Telegram] ${method} failed:`, err);
    return null;
  }
}

async function answerCallbackQuery(id) {
  await telegramRequest("answerCallbackQuery", { callback_query_id: id });
}

// ── /edit state machine ───────────────────────────────────

function clearEditSession(chatId) {
  const sess = editSessions.get(String(chatId));
  if (sess?.timer) clearTimeout(sess.timer);
  editSessions.delete(String(chatId));
}

function resetEditTimer(chatId, lang) {
  const sess = editSessions.get(String(chatId));
  if (!sess) return;
  if (sess.timer) clearTimeout(sess.timer);
  sess.timer = setTimeout(async () => {
    editSessions.delete(String(chatId));
    await sendTelegramMessage(chatId, bt(lang, "bot.edit.timeout"));
  }, EDIT_TIMEOUT_MS);
}

async function handleEditStart(chatId, lang) {
  clearEditSession(chatId);
  editSessions.set(String(chatId), { step: "search", query: "", candidates: [], selected: null, change: null, timer: null });
  resetEditTimer(chatId, lang);
  await sendTelegramMessage(chatId, bt(lang, "bot.edit.askName"));
}

async function handleEditStep(chatId, text, user, lang) {
  const sess = editSessions.get(String(chatId));
  if (!sess) return false;

  if (text === "/cancel") {
    clearEditSession(chatId);
    await sendTelegramMessage(chatId, bt(lang, "bot.edit.cancelled"));
    return true;
  }

  resetEditTimer(chatId, lang);

  // ── step: search ──────────────────────────────────────
  if (sess.step === "search") {
    const query = text.trim();
    const isAdmin    = user.role === "admin";
    const workspaces = await getWorkspaces(user);
    const wsFilter   = wsBotWhere(workspaces, isAdmin);

    const candidates = await prisma.reagent.findMany({
      where: {
        deletedAt: null,
        OR: [{ nameRu: { contains: query } }, { nameEn: { contains: query } }],
        ...wsFilter,
      },
      select: { id: true, nameRu: true, nameEn: true, quantity: true, unit: true },
      orderBy: { nameRu: "asc" },
      take: 10,
    });

    if (candidates.length === 0) {
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.notFound"));
      return true;
    }

    if (candidates.length === 1) {
      sess.selected = candidates[0];
      sess.step = "change";
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.currentState", {
        name: getName(candidates[0], lang),
        qty:  candidates[0].quantity,
        unit: candidates[0].unit,
      }));
      return true;
    }

    sess.candidates = candidates;
    sess.step = "select";
    const lines = [bt(lang, "bot.edit.multipleFound")];
    candidates.forEach((c, i) => {
      lines.push(`${i + 1}. ${getName(c, lang)} — ${c.quantity} ${c.unit}`);
    });
    lines.push(bt(lang, "bot.edit.enterNumber"));
    await sendTelegramMessage(chatId, lines.join("\n"));
    return true;
  }

  // ── step: select ──────────────────────────────────────
  if (sess.step === "select") {
    const n = parseInt(text.trim(), 10);
    if (isNaN(n) || n < 1 || n > sess.candidates.length) {
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.invalidNumber", { max: sess.candidates.length }));
      return true;
    }
    sess.selected = sess.candidates[n - 1];
    sess.step = "change";
    await sendTelegramMessage(chatId, bt(lang, "bot.edit.currentState", {
      name: getName(sess.selected, lang),
      qty:  sess.selected.quantity,
      unit: sess.selected.unit,
    }));
    return true;
  }

  // ── step: change ──────────────────────────────────────
  if (sess.step === "change") {
    const parsed = parseChange(text);
    if (!parsed) {
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.badFormat"));
      return true;
    }

    try {
      const newQty = applyChange(
        sess.selected.quantity, sess.selected.unit,
        parsed.sign * parsed.value, parsed.unit,
      );
      sess.change = { newQty };
      sess.step   = "confirm";
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.confirm", {
        name:   getName(sess.selected, lang),
        oldQty: sess.selected.quantity,
        unit:   sess.selected.unit,
        newQty,
      }));
    } catch (err) {
      await sendTelegramMessage(chatId, err.message + "\n" + bt(lang, "bot.edit.currentState", {
        name: getName(sess.selected, lang),
        qty:  sess.selected.quantity,
        unit: sess.selected.unit,
      }));
    }
    return true;
  }

  // ── step: confirm ─────────────────────────────────────
  if (sess.step === "confirm") {
    const answer = text.trim().toLowerCase();
    const isYes  = answer === "да" || answer === "yes";
    const isNo   = answer === "нет" || answer === "no";

    if (!isYes && !isNo) {
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.confirmHint"));
      return true;
    }

    if (isNo) {
      clearEditSession(chatId);
      await sendTelegramMessage(chatId, bt(lang, "bot.edit.cancelled"));
      return true;
    }

    const { selected, change } = sess;
    clearEditSession(chatId);

    await prisma.reagent.update({
      where: { id: selected.id },
      data:  { quantity: change.newQty },
    });

    await logAudit(user.id, "reagent", selected.id, "update", {
      quantity: { from: selected.quantity, to: change.newQty },
      source: "telegram_bot",
    });

    await sendTelegramMessage(chatId, bt(lang, "bot.edit.done", {
      name:   getName(selected, lang),
      newQty: change.newQty,
      unit:   selected.unit,
    }));
    return true;
  }

  return false;
}

// ── Command handlers ──────────────────────────────────────

async function handleStart(chatId) {
  const user = await getUserByChatId(chatId);
  const lang = user ? (user.language || "ru") : "ru";

  if (user) {
    userLangs.set(String(chatId), lang);
    userStates.delete(String(chatId));
    await sendTelegramMessage(chatId, bt(lang, "bot.start.welcome", { name: user.displayName }));
    return;
  }

  userStates.set(String(chatId), { step: "awaiting_username" });
  await sendTelegramMessage(chatId, bt("ru", "bot.start.askUsername"));
}

async function handleLow(chatId) {
  const lang = await getUserLang(chatId);
  const user = await getUserByChatId(chatId);
  if (!user) return;

  const isAdmin  = user.role === "admin";
  const workspaces = await getWorkspaces(user);
  const wmap     = Object.fromEntries(workspaces.map((w) => [w.id, w]));
  const multiWs  = workspaces.length > 1 || isAdmin;
  const where    = wsBotWhere(workspaces, isAdmin);

  const [reagents, consumables] = await Promise.all([
    prisma.reagent.findMany({
      where: { deletedAt: null, minQuantity: { not: null }, ...where },
      select: { nameRu: true, nameEn: true, quantity: true, minQuantity: true, unit: true, workspaceId: true },
      orderBy: { nameRu: "asc" },
    }),
    prisma.consumable.findMany({
      where: { deletedAt: null, minQuantity: { not: null }, ...where },
      select: { nameRu: true, nameEn: true, quantity: true, minQuantity: true, unit: true, workspaceId: true },
      orderBy: { nameRu: "asc" },
    }),
  ]);

  const lowReagents    = reagents.filter(r => r.quantity <= r.minQuantity);
  const lowConsumables = consumables.filter(c => c.quantity <= c.minQuantity);

  if (lowReagents.length === 0 && lowConsumables.length === 0) {
    await sendTelegramMessage(chatId, bt(lang, "bot.low.title") + "\n\n" + bt(lang, "bot.low.empty"));
    return;
  }

  const lines = [bt(lang, "bot.low.title")];

  if (multiWs) {
    const allItems = [
      ...lowReagents.map(r => ({ ...r, _type: "reagent" })),
      ...lowConsumables.map(c => ({ ...c, _type: "consumable" })),
    ];
    const groups = groupByWs(allItems);

    for (const wsId of Object.keys(groups)) {
      const ws = wmap[Number(wsId)];
      lines.push("\n\u{1F4C1} " + (ws ? wsName(ws, lang) : `#${wsId}`));
      const g = groups[wsId];
      const gReagents    = g.filter(i => i._type === "reagent");
      const gConsumables = g.filter(i => i._type === "consumable");
      if (gReagents.length > 0) {
        lines.push(bt(lang, "bot.low.reagents"));
        for (const r of gReagents) lines.push(`\u2014 ${getName(r, lang)}: ${r.quantity} / \u043C\u0438\u043D. ${r.minQuantity} ${r.unit}`);
      }
      if (gConsumables.length > 0) {
        lines.push(bt(lang, "bot.low.consumables"));
        for (const c of gConsumables) lines.push(`\u2014 ${getName(c, lang)}: ${c.quantity} / \u043C\u0438\u043D. ${c.minQuantity} ${c.unit}`);
      }
    }
  } else {
    if (lowReagents.length > 0) {
      lines.push("\n" + bt(lang, "bot.low.reagents"));
      for (const r of lowReagents) lines.push(`\u2014 ${getName(r, lang)}: ${r.quantity} / \u043C\u0438\u043D. ${r.minQuantity} ${r.unit}`);
    }
    if (lowConsumables.length > 0) {
      lines.push("\n" + bt(lang, "bot.low.consumables"));
      for (const c of lowConsumables) lines.push(`\u2014 ${getName(c, lang)}: ${c.quantity} / \u043C\u0438\u043D. ${c.minQuantity} ${c.unit}`);
    }
  }

  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function handleExpiring(chatId) {
  const lang  = await getUserLang(chatId);
  const user  = await getUserByChatId(chatId);
  if (!user) return;

  const isAdmin  = user.role === "admin";
  const workspaces = await getWorkspaces(user);
  const wmap     = Object.fromEntries(workspaces.map((w) => [w.id, w]));
  const multiWs  = workspaces.length > 1 || isAdmin;
  const where    = wsBotWhere(workspaces, isAdmin);
  const limit    = new Date(Date.now() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [reagents, consumables] = await Promise.all([
    prisma.reagent.findMany({
      where: { deletedAt: null, expiryDate: { not: null, lte: limit }, ...where },
      select: { nameRu: true, nameEn: true, expiryDate: true, workspaceId: true },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.consumable.findMany({
      where: { deletedAt: null, expiryDate: { not: null, lte: limit }, ...where },
      select: { nameRu: true, nameEn: true, expiryDate: true, workspaceId: true },
      orderBy: { expiryDate: "asc" },
    }),
  ]);

  if (reagents.length === 0 && consumables.length === 0) {
    await sendTelegramMessage(chatId, bt(lang, "bot.expiring.title") + "\n\n" + bt(lang, "bot.expiring.empty"));
    return;
  }

  const lines = [bt(lang, "bot.expiring.title")];

  if (multiWs) {
    const allItems = [
      ...reagents.map(r => ({ ...r, _type: "reagent" })),
      ...consumables.map(c => ({ ...c, _type: "consumable" })),
    ];
    const groups = groupByWs(allItems);

    for (const wsId of Object.keys(groups)) {
      const ws = wmap[Number(wsId)];
      lines.push("\n\u{1F4C1} " + (ws ? wsName(ws, lang) : `#${wsId}`));
      const g = groups[wsId];
      const gReagents    = g.filter(i => i._type === "reagent");
      const gConsumables = g.filter(i => i._type === "consumable");
      if (gReagents.length > 0) {
        lines.push(bt(lang, "bot.expiring.reagents"));
        for (const r of gReagents) lines.push(`\u2014 ${getName(r, lang)}: \u0434\u043E ${formatDate(r.expiryDate)}`);
      }
      if (gConsumables.length > 0) {
        lines.push(bt(lang, "bot.expiring.consumables"));
        for (const c of gConsumables) lines.push(`\u2014 ${getName(c, lang)}: \u0434\u043E ${formatDate(c.expiryDate)}`);
      }
    }
  } else {
    if (reagents.length > 0) {
      lines.push("\n" + bt(lang, "bot.expiring.reagents"));
      for (const r of reagents) lines.push(`\u2014 ${getName(r, lang)}: \u0434\u043E ${formatDate(r.expiryDate)}`);
    }
    if (consumables.length > 0) {
      lines.push("\n" + bt(lang, "bot.expiring.consumables"));
      for (const c of consumables) lines.push(`\u2014 ${getName(c, lang)}: \u0434\u043E ${formatDate(c.expiryDate)}`);
    }
  }

  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function handleSearch(chatId, query) {
  const lang = await getUserLang(chatId);
  const user = await getUserByChatId(chatId);
  if (!user) return;

  if (!query || query.trim().length < 2) {
    await sendTelegramMessage(chatId, bt(lang, "bot.search.usage"));
    return;
  }

  const isAdmin    = user.role === "admin";
  const workspaces = await getWorkspaces(user);
  const wmap       = Object.fromEntries(workspaces.map((w) => [w.id, w]));
  const multiWs    = workspaces.length > 1 || isAdmin;

  let results;

  if (!multiWs) {
    // Single workspace — simple search with workspace filter
    const fakeUser = { role: "user", activeWorkspaceId: workspaces[0]?.id ?? null };
    results = await search(query.trim(), lang, fakeUser, 5);
  } else if (isAdmin) {
    // Admin — search all data
    results = await search(query.trim(), lang, { role: "admin", activeWorkspaceId: null }, 5);
  } else {
    // Multi-workspace user — search per workspace and merge
    const perWs = await Promise.all(
      workspaces.map((ws) =>
        search(query.trim(), lang, { role: "user", activeWorkspaceId: ws.id }, 3)
          .then((r) => ({ wsId: ws.id, ...r }))
      )
    );
    results = { reagents: [], consumables: [], equipment: [], protocols: [], _perWs: perWs };
    for (const r of perWs) {
      results.reagents.push(...r.reagents);
      results.consumables.push(...r.consumables);
      results.equipment.push(...r.equipment);
      results.protocols.push(...r.protocols);
    }
    results._perWs = perWs;
  }

  const total = results.reagents.length + results.consumables.length +
                results.equipment.length + results.protocols.length;

  if (total === 0) {
    await sendTelegramMessage(chatId, bt(lang, "bot.search.title", { query }) + "\n\n" + bt(lang, "bot.search.empty"));
    return;
  }

  const lines = [bt(lang, "bot.search.title", { query })];

  if (multiWs && results._perWs) {
    for (const r of results._perWs) {
      const wsTotal = r.reagents.length + r.consumables.length + r.equipment.length + r.protocols.length;
      if (wsTotal === 0) continue;
      const ws = wmap[r.wsId];
      lines.push("\n\u{1F4C1} " + (ws ? wsName(ws, lang) : `#${r.wsId}`));
      if (r.reagents.length > 0) {
        lines.push(bt(lang, "bot.search.reagents"));
        for (const item of r.reagents) lines.push(`\u2014 ${lang === "en" && item.nameEn ? item.nameEn : item.nameRu}`);
      }
      if (r.consumables.length > 0) {
        lines.push(bt(lang, "bot.search.consumables"));
        for (const item of r.consumables) lines.push(`\u2014 ${lang === "en" && item.nameEn ? item.nameEn : item.nameRu}`);
      }
      if (r.equipment.length > 0) {
        lines.push(bt(lang, "bot.search.equipment"));
        for (const item of r.equipment) {
          const label = lang === "en" && item.nameEn ? item.nameEn : item.nameRu;
          lines.push(`\u2014 ${item.model ? `${label} (${item.model})` : label}`);
        }
      }
      if (r.protocols.length > 0) {
        lines.push(bt(lang, "bot.search.protocols"));
        for (const item of r.protocols) lines.push(`\u2014 ${lang === "en" && item.titleEn ? item.titleEn : item.titleRu}`);
      }
    }
  } else {
    if (results.reagents.length > 0) {
      lines.push("\n" + bt(lang, "bot.search.reagents"));
      for (const r of results.reagents) lines.push(`\u2014 ${lang === "en" && r.nameEn ? r.nameEn : r.nameRu}`);
    }
    if (results.consumables.length > 0) {
      lines.push("\n" + bt(lang, "bot.search.consumables"));
      for (const c of results.consumables) lines.push(`\u2014 ${lang === "en" && c.nameEn ? c.nameEn : c.nameRu}`);
    }
    if (results.equipment.length > 0) {
      lines.push("\n" + bt(lang, "bot.search.equipment"));
      for (const e of results.equipment) {
        const label = lang === "en" && e.nameEn ? e.nameEn : e.nameRu;
        lines.push(`\u2014 ${e.model ? `${label} (${e.model})` : label}`);
      }
    }
    if (results.protocols.length > 0) {
      lines.push("\n" + bt(lang, "bot.search.protocols"));
      for (const p of results.protocols) lines.push(`\u2014 ${lang === "en" && p.titleEn ? p.titleEn : p.titleRu}`);
    }
  }

  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function handleOrders(chatId) {
  const lang = await getUserLang(chatId);
  const user = await getUserByChatId(chatId);
  if (!user) return;

  const isAdmin    = user.role === "admin";
  const workspaces = await getWorkspaces(user);
  const wmap       = Object.fromEntries(workspaces.map((w) => [w.id, w]));
  const multiWs    = workspaces.length > 1 || isAdmin;
  const where      = wsBotWhere(workspaces, isAdmin);

  const count = await prisma.orderItem.count({ where });

  if (count === 0) {
    await sendTelegramMessage(chatId, bt(lang, "bot.orders.title") + "\n\n" + bt(lang, "bot.orders.empty"));
    return;
  }

  if (!multiWs) {
    await sendTelegramMessage(chatId, bt(lang, "bot.orders.title") + "\n\n" + bt(lang, "bot.orders.count", { count }));
    return;
  }

  // Multi-workspace: show count per workspace
  const lines = [bt(lang, "bot.orders.title")];
  for (const ws of workspaces) {
    const wsCount = await prisma.orderItem.count({ where: { workspaceId: ws.id } });
    if (wsCount > 0) {
      lines.push(`\u{1F4C1} ${wsName(ws, lang)}: ${bt(lang, "bot.orders.count", { count: wsCount })}`);
    }
  }
  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function handleHelp(chatId) {
  const lang = await getUserLang(chatId);
  await sendTelegramMessage(chatId, bt(lang, "bot.help.text"));
}

// ── State machine (account linking) ──────────────────────

async function handleConversationStep(chatId, text) {
  const state = userStates.get(String(chatId));
  if (!state) return false;

  if (state.step === "awaiting_username") {
    const username = text.trim();
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      await sendTelegramMessage(chatId, bt("ru", "bot.start.notFound", { username }));
      return true;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: String(chatId) },
    });

    userLangs.set(String(chatId), user.language || "ru");
    userStates.delete(String(chatId));

    const lang = user.language || "ru";
    await sendTelegramMessage(chatId, bt(lang, "bot.start.linked", { name: user.displayName }));
    return true;
  }

  return false;
}

// ── Main message processor ────────────────────────────────

async function processMessage(message) {
  const chatId = message.chat && message.chat.id;
  const text   = message.text ? message.text.trim() : "";

  if (!chatId || !text) return;

  if (text === "/start" || text.startsWith("/start ")) {
    await handleStart(chatId);
    return;
  }

  if (await handleConversationStep(chatId, text)) return;

  const user = await getUserByChatId(chatId);
  if (!user) {
    const lang = await getUserLang(chatId);
    await sendTelegramMessage(chatId, bt(lang, "bot.unauthorized"));
    return;
  }

  const lang = user.language || "ru";
  userLangs.set(String(chatId), lang);

  // Route to /edit state machine: /cancel always, non-commands when session active
  if (text === "/cancel" || (editSessions.has(String(chatId)) && !text.startsWith("/"))) {
    if (await handleEditStep(chatId, text, user, lang)) return;
  }

  if (text === "/edit")     { await handleEditStart(chatId, lang); return; }
  if (text === "/low")      { await handleLow(chatId);             return; }
  if (text === "/expiring") { await handleExpiring(chatId);        return; }
  if (text === "/orders")   { await handleOrders(chatId);          return; }
  if (text === "/help")     { await handleHelp(chatId);            return; }

  if (text.startsWith("/search")) {
    const query = text.slice("/search".length).trim();
    await handleSearch(chatId, query);
    return;
  }

  await sendTelegramMessage(chatId, bt(lang, "bot.unknown"));
}

// ── Polling ───────────────────────────────────────────────

async function pollTelegramUpdates() {
  if (!activeToken) return;
  if (isPolling) return;

  isPolling = true;

  try {
    const url = new URL(`https://api.telegram.org/bot${activeToken}/getUpdates`);
    url.searchParams.set("timeout", "0");
    if (lastUpdateId > 0) url.searchParams.set("offset", String(lastUpdateId));

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Telegram] getUpdates error: ${response.status} ${errorText}`);
      return;
    }

    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.result)) return;

    for (const update of payload.result) {
      lastUpdateId = update.update_id + 1;
      if (update.message)        await processMessage(update.message);
      if (update.callback_query) await answerCallbackQuery(update.callback_query.id);
    }
  } catch (err) {
    console.error("[Telegram] Polling failed:", err);
  } finally {
    isPolling = false;
  }
}

async function testTelegramConnectivity(token) {
  if (!token) {
    console.warn("[Telegram] BOT_TOKEN not configured. Bot will not start.");
    return false;
  }

  console.log("[Telegram] Testing connectivity to api.telegram.org...");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.result) {
        console.log(`[Telegram] Connected as @${data.result.username} (ID: ${data.result.id})`);
        return true;
      }
    }

    const text = await response.text();
    console.error(`[Telegram] API error: ${response.status} ${text}`);
    return false;
  } catch (err) {
    console.error("[Telegram] Cannot reach api.telegram.org:");
    console.error(`[Telegram]   ${err.message}`);
    console.error("[Telegram] Check Docker network / Synology firewall (outbound TCP 443).");
    return false;
  }
}

async function startTelegramBotPolling() {
  const botActive = await getSetting("BOT_ACTIVE");
  const botToken  = await getSetting("BOT_TOKEN");

  if (botActive !== "true") {
    console.log("[Telegram] Bot disabled (BOT_ACTIVE != true). Skipping start.");
    return;
  }

  const connected = await testTelegramConnectivity(botToken);
  if (!connected) {
    console.warn("[Telegram] Bot will not start — connectivity test failed.");
    return;
  }

  activeToken  = botToken;
  pollingTimer = setInterval(() => { pollTelegramUpdates(); }, POLLING_INTERVAL_MS);
  console.log("[Telegram] Bot polling started.");
}

function stopTelegramBotPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    activeToken  = null;
    console.log("[Telegram] Bot polling stopped.");
  }
}

function isBotPolling() {
  return pollingTimer !== null;
}

module.exports = {
  startTelegramBotPolling,
  stopTelegramBotPolling,
  testTelegramConnectivity,
  isBotPolling,
};
