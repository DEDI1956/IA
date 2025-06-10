import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('config.json'));
const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

const userState = {};

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⚡ Deploy Worker", callback_data: "deploy_worker" },
          { text: "📝 List Worker", callback_data: "list_worker" }
        ],
        [
          { text: "❌ Delete Worker", callback_data: "delete_worker" },
          { text: "🔒 Logout", callback_data: "logout" }
        ]
      ]
    }
  };
}

function deploySuccessMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔄 Deploy Lagi", callback_data: "deploy_worker" },
          { text: "🏠 Ke Menu", callback_data: "main_menu" }
        ]
      ]
    }
  };
}

// Simple user DB (in-memory, bisa diganti file/DB)
let users = {};

function saveUser(userId, data) {
  users[userId] = { ...(users[userId] || {}), ...data };
}
function getUser(userId) {
  return users[userId] || {};
}
function resetUserSession(userId) {
  if (userState[userId]) delete userState[userId];
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.from.id;
  saveUser(chatId, { username: msg.from.username });
  resetUserSession(chatId);
  bot.sendMessage(chatId, "Selamat datang!\nSilakan masukkan *API Token Cloudflare* kamu:", { parse_mode: "Markdown" });
  userState[chatId] = { step: "awaiting_token" };
});

bot.on('message', async (msg) => {
  const chatId = msg.from.id;
  const text = msg.text;
  if (msg.entities && msg.entities[0].type === "bot_command") return; // biar handler command tetap jalan
  const state = userState[chatId];

  // Step 1: Token
  if (state && state.step === "awaiting_token") {
    saveUser(chatId, { token: text });
    bot.sendMessage(chatId, "Masukkan *Account ID* Cloudflare kamu:", { parse_mode: "Markdown" });
    userState[chatId].step = "awaiting_account";
    return;
  }
  // Step 2: Account ID
  if (state && state.step === "awaiting_account") {
    saveUser(chatId, { account_id: text });
    bot.sendMessage(chatId, "Masukkan *Zone ID* Cloudflare kamu:", { parse_mode: "Markdown" });
    userState[chatId].step = "awaiting_zone";
    return;
  }
  // Step 3: Zone ID
  if (state && state.step === "awaiting_zone") {
    saveUser(chatId, { zone_id: text });
    bot.sendMessage(chatId, "✅ Setup selesai!\n\nBerikut menunya:", mainMenu());
    resetUserSession(chatId);
    return;
  }
  // Step Deploy Nama Worker
  if (state && state.step === "awaiting_worker_name") {
    userState[chatId].worker_name = text.trim();
    userState[chatId].step = "awaiting_worker_code";
    bot.sendMessage(chatId, "💻 Silakan kirim kode JavaScript (.js) untuk Worker kamu:");
    return;
  }
  // Step Deploy Kode Worker
  if (state && state.step === "awaiting_worker_code") {
    const workerName = userState[chatId].worker_name;
    const jsCode = text;
    const user = getUser(chatId);

    const apiUrl = `${config.CLOUDFLARE_API_ENDPOINT}/${user.account_id}/workers/scripts/${workerName}`;
    try {
      const res = await fetch(apiUrl, {
        method: 'PUT',
        body: jsCode,
        headers: {
          "Authorization": `Bearer ${user.token}`,
          "Content-Type": "application/javascript"
        }
      });
      const data = await res.json();
      if (data.success) {
        const url = `https://${workerName}.${user.zone_id}.workers.dev`;
        bot.sendMessage(chatId,
          `✅ Worker berhasil dideploy!\n🔗 Nama Worker: ${workerName}\n🌐 URL Worker: ${url}`,
          deploySuccessMenu()
        );
      } else {
        bot.sendMessage(chatId, `❌ Deploy gagal: ${data.errors?.[0]?.message || "Unknown error"}`);
      }
    } catch (e) {
      bot.sendMessage(chatId, `❌ Deploy gagal: ${e.message}`);
    }
    resetUserSession(chatId);
    return;
  }
});

// Inline Button Handler
bot.on('callback_query', async (query) => {
  const chatId = query.from.id;
  const data = query.data;

  if (data === "main_menu") {
    bot.editMessageText("🚀 Menu Utama:\nSilakan pilih fitur:", { chat_id: chatId, message_id: query.message.message_id, ...mainMenu() });
  }

  if (data === "deploy_worker") {
    userState[chatId] = { step: "awaiting_worker_name" };
    bot.sendMessage(chatId, "🏷️ Silakan masukkan nama Worker yang ingin dibuat:");
  }

  // TODO: handle list_worker, delete_worker, logout, admin panel, dsb

  // Jawab supaya loading di tombol hilang
  bot.answerCallbackQuery(query.id);
});
