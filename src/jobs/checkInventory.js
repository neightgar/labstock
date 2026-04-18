const cron = require("node-cron");
const prisma = require("../utils/prisma");
const { sendTelegramMessage } = require("../services/telegram");
const { bt } = require("../services/botI18n");

const EXPIRY_WINDOW_DAYS = 7;

function formatDate(date) {
  return new Date(date).toISOString().split("T")[0];
}

function getName(item, lang) {
  return (lang === "en" && item.nameEn) ? item.nameEn : item.nameRu;
}

function groupByWs(items) {
  const map = {};
  for (const item of items) {
    const k = item.workspaceId ?? 0;
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}

async function checkOverdueOrders() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueItems = await prisma.orderItem.findMany({
      where: {
        deliveryDate:    { lt: today },
        notifyOnOverdue: true,
      },
      include: {
        creator: { select: { id: true, telegramChatId: true, language: true } },
      },
    });

    if (overdueItems.length === 0) return;

    // Group by creator
    const byUser = {};
    for (const item of overdueItems) {
      const uid = item.createdBy;
      if (!byUser[uid]) byUser[uid] = { user: item.creator, items: [] };
      byUser[uid].items.push(item);
    }

    for (const { user, items } of Object.values(byUser)) {
      if (!user?.telegramChatId) continue;
      const lang = user.language || "ru";
      const lines = [lang === "en" ? "⚠️ Delivery overdue:" : "⚠️ Срок поставки истёк:"];
      for (const item of items) {
        const name = (lang === "en" && item.nameEn) ? item.nameEn : item.nameRu;
        const date = formatDate(item.deliveryDate);
        lines.push(`• ${name} | ${item.quantity} ${item.unit} | ${date}`);
      }
      await sendTelegramMessage(user.telegramChatId, lines.join("\n"));
    }
  } catch (err) {
    console.error("[checkOverdueOrders] Job failed:", err);
  }
}

async function checkInventory() {
  try {
    const expiryLimit = new Date(Date.now() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Load all workspaces for label lookup
    const allWorkspaces = await prisma.workspace.findMany({ orderBy: { id: "asc" } });
    const wmap = Object.fromEntries(allWorkspaces.map((w) => [w.id, w]));

    // Fetch all potentially affected items in parallel (across all workspaces)
    const [reagents, consumables] = await Promise.all([
      prisma.reagent.findMany({
        where: { deletedAt: null },
        select: {
          nameRu: true, nameEn: true,
          quantity: true, minQuantity: true, unit: true,
          expiryDate: true, workspaceId: true,
        },
      }),
      prisma.consumable.findMany({
        where: { deletedAt: null },
        select: {
          nameRu: true, nameEn: true,
          quantity: true, minQuantity: true, unit: true,
          expiryDate: true, workspaceId: true,
        },
      }),
    ]);

    // Send to each user with a linked Telegram chat
    const users = await prisma.user.findMany({
      where: { telegramChatId: { not: null } },
      select: {
        telegramChatId: true, language: true, role: true,
        workspaceMembers: { select: { workspaceId: true } },
      },
    });

    for (const user of users) {
      const lang   = user.language || "ru";
      const chatId = user.telegramChatId;

      // Determine which workspace IDs this user should see
      let visibleWsIds; // null = all workspaces (admin)
      if (user.role === "admin") {
        visibleWsIds = null;
      } else {
        visibleWsIds = new Set(user.workspaceMembers.map((m) => m.workspaceId));
        if (visibleWsIds.size === 0) continue; // user has no workspaces
      }

      const inScope = (item) =>
        visibleWsIds === null || visibleWsIds.has(item.workspaceId);

      const scopedReagents    = reagents.filter(inScope);
      const scopedConsumables = consumables.filter(inScope);

      // Low stock
      const lowReagents    = scopedReagents.filter(r => r.minQuantity != null && r.quantity <= r.minQuantity);
      const lowConsumables = scopedConsumables.filter(c => c.minQuantity != null && c.quantity <= c.minQuantity);

      // Expiring soon
      const expiringReagents    = scopedReagents.filter(r => r.expiryDate && new Date(r.expiryDate) <= expiryLimit);
      const expiringConsumables = scopedConsumables.filter(c => c.expiryDate && new Date(c.expiryDate) <= expiryLimit);

      const hasAlerts =
        lowReagents.length > 0 || lowConsumables.length > 0 ||
        expiringReagents.length > 0 || expiringConsumables.length > 0;

      if (!hasAlerts) continue;

      const wsCount = visibleWsIds === null ? allWorkspaces.length : visibleWsIds.size;
      const multiWs = wsCount > 1;

      const lines = [bt(lang, "bot.notify.subject")];

      if (multiWs) {
        // Group alerts by workspace
        const allLow = [
          ...lowReagents.map(r => ({ ...r, _type: "reagent" })),
          ...lowConsumables.map(c => ({ ...c, _type: "consumable" })),
        ];
        const allExpiring = [
          ...expiringReagents.map(r => ({ ...r, _type: "reagent" })),
          ...expiringConsumables.map(c => ({ ...c, _type: "consumable" })),
        ];

        // Collect all workspace IDs that appear in alerts
        const alertWsIds = new Set([
          ...allLow.map(i => i.workspaceId),
          ...allExpiring.map(i => i.workspaceId),
        ]);

        for (const wsId of alertWsIds) {
          const ws = wmap[wsId];
          const wsLabel = ws ? (lang === "en" && ws.nameEn ? ws.nameEn : ws.nameRu) : `#${wsId}`;
          lines.push("\n\u{1F4C1} " + wsLabel);

          const wsLow      = allLow.filter(i => i.workspaceId === wsId);
          const wsExpiring = allExpiring.filter(i => i.workspaceId === wsId);

          if (wsLow.length > 0) {
            lines.push(bt(lang, "bot.notify.lowStock"));
            for (const item of wsLow) {
              lines.push(`\u2014 ${getName(item, lang)}: ${item.quantity} / \u043C\u0438\u043D. ${item.minQuantity} ${item.unit}`);
            }
          }
          if (wsExpiring.length > 0) {
            lines.push(bt(lang, "bot.notify.expiring"));
            for (const item of wsExpiring) {
              lines.push(`\u2014 ${getName(item, lang)}: \u0434\u043E ${formatDate(item.expiryDate)}`);
            }
          }
        }
      } else {
        // Single workspace — flat list (original format)
        if (lowReagents.length > 0 || lowConsumables.length > 0) {
          lines.push("\n" + bt(lang, "bot.notify.lowStock"));
          for (const r of lowReagents) {
            lines.push(`\u2014 ${getName(r, lang)}: ${r.quantity} / \u043C\u0438\u043D. ${r.minQuantity} ${r.unit}`);
          }
          for (const c of lowConsumables) {
            lines.push(`\u2014 ${getName(c, lang)}: ${c.quantity} / \u043C\u0438\u043D. ${c.minQuantity} ${c.unit}`);
          }
        }

        if (expiringReagents.length > 0 || expiringConsumables.length > 0) {
          lines.push("\n" + bt(lang, "bot.notify.expiring"));
          for (const r of expiringReagents) {
            lines.push(`\u2014 ${getName(r, lang)}: \u0434\u043E ${formatDate(r.expiryDate)}`);
          }
          for (const c of expiringConsumables) {
            lines.push(`\u2014 ${getName(c, lang)}: \u0434\u043E ${formatDate(c.expiryDate)}`);
          }
        }
      }

      await sendTelegramMessage(chatId, lines.join("\n"));
    }
  } catch (err) {
    console.error("[checkInventory] Job failed:", err);
  }
}

function startInventoryCheckJob() {
  // Run every day at 09:00
  cron.schedule("0 9 * * *", () => {
    checkInventory();
    checkOverdueOrders();
  });
  console.log("[checkInventory] Daily 09:00 job scheduled.");
}

module.exports = { checkInventory, checkOverdueOrders, startInventoryCheckJob };
