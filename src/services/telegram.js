const { getSetting } = require("./settings");

async function sendTelegramMessage(chatId, text, options = {}) {
  const token = await getSetting("BOT_TOKEN");

  if (!token || !chatId) {
    if (!token) console.warn("[Telegram] BOT_TOKEN not configured. Skipping message send.");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Telegram] sendMessage error: ${response.status} ${errorText}`);
    }
  } catch (error) {
    console.error("[Telegram] Failed to send message:", error);
  }
}

module.exports = { sendTelegramMessage };
