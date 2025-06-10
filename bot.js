import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import fs from 'fs';

// ---- CONFIG ----
const config = JSON.parse(fs.readFileSync('config.json'));
const TOKEN = config.TELEGRAM_BOT_TOKEN;
const API_BASE = config.CLOUDFLARE_API_ENDPOINT || "https://api.cloudflare.com/client/v4/accounts";

// ---- INISIALISASI BOT ----
const bot = new TelegramBot(TOKEN, { polling: true });

// ---- STATE ----
const userState = {}; // { [chatId]: { step, data } }
const userData = {};  // { [chatId]: { token, account_id, zone_id } }

// ---- MENU UTAMA ----
function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⚡ Deploy Worker", callback_data: "deploy_worker" },
          { text: "📝 List Worker", callback_data: "list_worker" }
        ],
        [
          { text: "🔑 Binding KV", callback_data: "binding_kv" },
          { text: "❌ Unbind KV", callback_data: "unbind_kv" }
        ],
        [
          { text: "🗑️ Delete Worker", callback_data: "delete_worker" },
          { text: "🔒 Logout", callback_data: "logout" }
        ]
      ]
    }
  };
}

// ---- KATA SAMBUTAN ----
function welcomeMessage() {
  return `
👋 Selamat datang di *Cloudflare Worker Bot*!

Bot ini membantumu mengelola Cloudflare Worker langsung dari Telegram 🚀

✨ *Fitur utama:*
• ⚡ Deploy Worker ke Cloudflare
• 📝 Lihat daftar Worker aktif
• 🗑️ Hapus Worker
• 🔑 Kelola Binding KV Storage (tambah & hapus)
• 🔒 Logout & reset akun Cloudflare

📋 *Petunjuk:*
1. Siapkan API Token & Account ID Cloudflare (gunakan menu jika belum).
2. Pilih menu sesuai kebutuhan di bawah.
3. Ikuti instruksi bot saat menambah/deploy/binding Worker.

Ayo mulai! Pilih menu di bawah ini ⬇️
  `;
}

// ---- FUNGSI BANTUAN ----
function getUser(chatId) {
  if (!userData[chatId]) userData[chatId] = {};
  return userData[chatId];
}
function resetUser(chatId) {
  delete userData[chatId];
  delete userState[chatId];
}

// ---- START COMMAND ----
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, welcomeMessage(), {
    parse_mode: "Markdown",
    ...mainMenu()
  });
  // Prompt input akun jika belum ada
  if (!getUser(chatId).token) {
    bot.sendMessage(chatId, "🔑 Silakan masukkan *API Token* Cloudflare:", { parse_mode: "Markdown" });
    userState[chatId] = { step: "await_token" };
  }
});

// ---- INPUT API TOKEN, ACCOUNT ID, ZONE ID ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId] || !userState[chatId].step) return;
  const step = userState[chatId].step;
  const text = msg.text.trim();
  const user = getUser(chatId);

  if (step === "await_token") {
    user.token = text;
    userState[chatId] = { step: "await_account_id" };
    bot.sendMessage(chatId, "🔢 Masukkan *Account ID* Cloudflare kamu:", { parse_mode: "Markdown" });
    return;
  }
  if (step === "await_account_id") {
    user.account_id = text;
    userState[chatId] = { step: "await_zone_id" };
    bot.sendMessage(chatId, "🌐 Masukkan *Zone ID* Cloudflare kamu:", { parse_mode: "Markdown" });
    return;
  }
  if (step === "await_zone_id") {
    user.zone_id = text;
    userState[chatId] = {};
    bot.sendMessage(chatId, "✅ Akun berhasil disimpan! Pilih menu di bawah.", mainMenu());
    return;
  }

  // Deploy Worker - Step by Step
  if (step === "deploy_worker_name") {
    userState[chatId] = { step: "deploy_worker_code", worker_name: text };
    bot.sendMessage(chatId, "✏️ Kirim kode JavaScript *Worker* kamu:", { parse_mode: "Markdown" });
    return;
  }
  if (step === "deploy_worker_code") {
    const worker_name = userState[chatId].worker_name;
    await deployWorker(chatId, user, worker_name, text);
    userState[chatId] = {};
    return;
  }

  // Binding KV - Step by Step
  if (step === "binding_kv_worker") {
    userState[chatId] = { step: "binding_kv_var", worker_name: text };
    bot.sendMessage(chatId, "🔑 Masukkan *nama variable binding* (contoh: MY_KV):", { parse_mode: "Markdown" });
    return;
  }
  if (step === "binding_kv_var") {
    userState[chatId] = { ...userState[chatId], step: "binding_kv_ns", binding_var: text };
    bot.sendMessage(chatId, "🗂️ Masukkan *Namespace ID* KV Storage yang ingin di-bind:", { parse_mode: "Markdown" });
    return;
  }
  if (step === "binding_kv_ns") {
    const { worker_name, binding_var } = userState[chatId];
    await bindingKV(chatId, user, worker_name, binding_var, text);
    userState[chatId] = {};
    return;
  }

  // Unbinding KV - Step by Step
  if (step === "unbind_kv_worker") {
    userState[chatId] = { step: "unbind_kv_binding", worker_name: text };
    // Ambil daftar binding
    const bindings = await getWorkerBindings(user, text);
    if (!bindings || bindings.length === 0) {
      bot.sendMessage(chatId, "❌ Worker ini tidak punya KV Binding.");
      userState[chatId] = {};
    } else {
      const opts = {
        reply_markup: {
          inline_keyboard: bindings.map(b => [
            { text: b.name, callback_data: `unbind_kv_confirm:${text}:${b.name}` }
          ])
        }
      };
      bot.sendMessage(chatId, "Pilih binding yang ingin dihapus:", opts);
    }
    return;
  }
});

// ---- CALLBACK HANDLER ----
bot.on('callback_query', async (query) => {
  const chatId = query.from.id;
  const data = query.data;
  const user = getUser(chatId);

  if (data === "main_menu") {
    bot.editMessageText(welcomeMessage(), { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown", ...mainMenu() });
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "deploy_worker") {
    userState[chatId] = { step: "deploy_worker_name" };
    bot.sendMessage(chatId, "🏷️ Masukkan *nama Worker* yang ingin dibuat:", { parse_mode: "Markdown" });
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "list_worker") {
    await listWorker(chatId, user);
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "delete_worker") {
    const names = await fetchWorkerNames(user);
    if (!names.length) {
      bot.sendMessage(chatId, "❌ Tidak ada Worker yang bisa dihapus.");
    } else {
      const opts = {
        reply_markup: {
          inline_keyboard: names.map(n => [{ text: n, callback_data: `delete_worker_confirm:${n}` }])
        }
      };
      bot.sendMessage(chatId, "Pilih Worker yang ingin dihapus:", opts);
    }
    return bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith("delete_worker_confirm:")) {
    const name = data.split(":")[1];
    const ok = await deleteWorker(user, name);
    bot.sendMessage(chatId, ok ? `✅ Worker *${name}* berhasil dihapus.` : `❌ Gagal menghapus worker *${name}*.`);
    return bot.answerCallbackQuery(query.id);
  }

  // Binding KV
  if (data === "binding_kv") {
    userState[chatId] = { step: "binding_kv_worker" };
    bot.sendMessage(chatId, "🏷️ Masukkan *nama Worker* yang ingin di-binding:", { parse_mode: "Markdown" });
    return bot.answerCallbackQuery(query.id);
  }

  // Unbind KV
  if (data === "unbind_kv") {
    userState[chatId] = { step: "unbind_kv_worker" };
    bot.sendMessage(chatId, "🏷️ Masukkan *nama Worker* yang ingin di-unbinding:", { parse_mode: "Markdown" });
    return bot.answerCallbackQuery(query.id);
  }
  if (data.startsWith("unbind_kv_confirm:")) {
    const [, worker_name, binding_name] = data.split(":");
    const ok = await unbindingKV(chatId, user, worker_name, binding_name);
    bot.sendMessage(chatId, ok ? `✅ Binding *${binding_name}* berhasil dihapus dari Worker *${worker_name}*.` : `❌ Gagal hapus binding.`);
    return bot.answerCallbackQuery(query.id);
  }

  // Logout
  if (data === "logout") {
    resetUser(chatId);
    bot.sendMessage(chatId, "🔒 Kamu telah logout. Kirim /start untuk mulai lagi.");
    return bot.answerCallbackQuery(query.id);
  }

  bot.answerCallbackQuery(query.id);
});

// ---- DEPLOY WORKER ----
async function deployWorker(chatId, user, name, code) {
  if (!user.token || !user.account_id) {
    bot.sendMessage(chatId, "⚠️ Kamu belum setup akun Cloudflare. Gunakan /start dulu.");
    return;
  }
  const url = `${API_BASE}/${user.account_id}/workers/scripts/${name}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        "Authorization": `Bearer ${user.token}`,
        "Content-Type": "application/javascript"
      },
      body: code
    });
    const data = await res.json();
    bot.sendMessage(chatId, data.success ? `✅ Worker *${name}* berhasil di-deploy!` : `❌ Gagal deploy: ${JSON.stringify(data.errors)}`);
  } catch (e) {
    bot.sendMessage(chatId, "❌ Error koneksi ke Cloudflare API.");
  }
}

// ---- LIST WORKER ----
async function listWorker(chatId, user) {
  if (!user.token || !user.account_id) {
    bot.sendMessage(chatId, "⚠️ Kamu belum setup akun Cloudflare. Gunakan /start dulu.");
    return;
  }
  const url = `${API_BASE}/${user.account_id}/workers/scripts`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (!data.success) return bot.sendMessage(chatId, "❌ Gagal ambil daftar worker.");
    if (!data.result.length) return bot.sendMessage(chatId, "📭 Belum ada worker di akun Cloudflare-mu.");
    const list = data.result.map(w => `• ${w.id}`).join('\n');
    bot.sendMessage(chatId, `📝 Daftar Worker:\n${list}`);
  } catch (e) {
    bot.sendMessage(chatId, "❌ Error koneksi ke Cloudflare API.");
  }
}

async function fetchWorkerNames(user) {
  if (!user.token || !user.account_id) return [];
  const url = `${API_BASE}/${user.account_id}/workers/scripts`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (!data.success) return [];
    return data.result.map(w => w.id);
  } catch {
    return [];
  }
}

// ---- DELETE WORKER ----
async function deleteWorker(user, name) {
  if (!user.token || !user.account_id) return false;
  const url = `${API_BASE}/${user.account_id}/workers/scripts/${name}`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    return data.success;
  } catch {
    return false;
  }
}

// ---- BINDING KV ----
async function bindingKV(chatId, user, worker_name, binding_var, ns_id) {
  if (!user.token || !user.account_id) {
    bot.sendMessage(chatId, "⚠️ Kamu belum setup akun Cloudflare.");
    return;
  }
  // Ambil kode worker & binding lama
  const getUrl = `${API_BASE}/${user.account_id}/workers/scripts/${worker_name}`;
  try {
    const res = await fetch(getUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (!data.success) return bot.sendMessage(chatId, "❌ Worker tidak ditemukan.");
    // Ambil code dan binding lama
    const code = data.result?.script ?? "";
    const bindings = (data.result?.bindings || []).filter(b => b.type === "kv_namespace");
    // Tambah binding baru
    const newBindings = [...bindings, { name: binding_var, type: "kv_namespace", namespace_id: ns_id }];
    // Deploy ulang
    const putUrl = `${API_BASE}/${user.account_id}/workers/scripts/${worker_name}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        "Authorization": `Bearer ${user.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        script: code,
        bindings: newBindings
      })
    });
    const putData = await putRes.json();
    bot.sendMessage(chatId, putData.success ? `✅ Binding KV *${binding_var}* berhasil ditambahkan ke Worker *${worker_name}*.` : `❌ Gagal binding: ${JSON.stringify(putData.errors)}`);
  } catch (e) {
    bot.sendMessage(chatId, "❌ Error koneksi ke Cloudflare API.");
  }
}

// ---- UNBINDING KV ----
async function getWorkerBindings(user, worker_name) {
  if (!user.token || !user.account_id) return [];
  const url = `${API_BASE}/${user.account_id}/workers/scripts/${worker_name}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (!data.success) return [];
    return (data.result?.bindings || []).filter(b => b.type === "kv_namespace");
  } catch {
    return [];
  }
}

async function unbindingKV(chatId, user, worker_name, binding_name) {
  if (!user.token || !user.account_id) return false;
  // Ambil kode worker & binding lama
  const getUrl = `${API_BASE}/${user.account_id}/workers/scripts/${worker_name}`;
  try {
    const res = await fetch(getUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (!data.success) return false;
    // Ambil code dan binding lama
    const code = data.result?.script ?? "";
    const bindings = (data.result?.bindings || []).filter(b => b.type === "kv_namespace" && b.name !== binding_name);
    // Deploy ulang tanpa binding yang dihapus
    const putUrl = `${API_BASE}/${user.account_id}/workers/scripts/${worker_name}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        "Authorization": `Bearer ${user.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        script: code,
        bindings: bindings
      })
    });
    const putData = await putRes.json();
    return !!putData.success;
  } catch {
    return false;
  }
}
