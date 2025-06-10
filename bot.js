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
const userState = {}; // { [chatId]: { step, ... } }
const userData = {};  // { [chatId]: { token, account_id, zone_id, workers_subdomain } }

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
          { text: "🗑️ Delete Worker", callback_data: "delete_worker" }
        ],
        [
          { text: "🔍 List Worker KV", callback_data: "list_worker_kv" }
        ],
        [
          { text: "🔒 Logout", callback_data: "logout" }
        ]
      ]
    }
  };
}

// ---- KATA SAMBUTAN ----
function welcomeMessage() {
  return `
<b>👋 Selamat datang di Cloudflare Worker Bot!</b>

Bot ini membantumu mengelola <b>Cloudflare Worker</b> langsung dari Telegram 🚀

<b>✨ Fitur utama:</b>
• ⚡ <b>Deploy Worker</b> ke Cloudflare (bisa upload file .js)
• 📝 <b>Lihat daftar Worker aktif</b>
• 🗑️ <b>Hapus Worker</b>
• 🔑 <b>Kelola Binding KV Storage</b> (tambah & hapus)
• 🔍 <b>Lihat Worker yang sudah ter-binding KV</b>
• 🔒 <b>Logout & reset akun Cloudflare</b>

<b>📋 Petunjuk:</b>
1. Siapkan <b>API Token & Account ID</b> Cloudflare (akan diminta saat pertama kali).
2. Pilih menu sesuai kebutuhan di bawah.
3. Ikuti instruksi bot saat menambah/deploy/binding Worker.

<i>Ayo mulai! Pilih menu di bawah ini ⬇️</i>
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
    parse_mode: "HTML",
    ...mainMenu()
  });
  if (!getUser(chatId).token) {
    bot.sendMessage(chatId, "🔑 Silakan masukkan <b>API Token</b> Cloudflare kamu:", { parse_mode: "HTML" });
    userState[chatId] = { step: "await_token" };
  }
});

// ---- INPUT API TOKEN, ACCOUNT ID, ZONE ID ----
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!userState[chatId] || !userState[chatId].step) return;
  const step = userState[chatId].step;
  const text = msg.text.trim();
  const user = getUser(chatId);

  // 1. Setup Akun
  if (step === "await_token") {
    user.token = text;
    userState[chatId] = { step: "await_account_id" };
    bot.sendMessage(chatId, "🔢 Masukkan <b>Account ID</b> Cloudflare kamu:", { parse_mode: "HTML" });
    return;
  }
  if (step === "await_account_id") {
    user.account_id = text;
    userState[chatId] = { step: "await_zone_id" };
    bot.sendMessage(chatId, "🌐 Masukkan <b>Zone ID</b> Cloudflare kamu:", { parse_mode: "HTML" });
    return;
  }
  if (step === "await_zone_id") {
    user.zone_id = text;
    userState[chatId] = { step: "await_workers_subdomain" };
    bot.sendMessage(chatId, "📝 Masukkan <b>subdomain Workers</b> Cloudflare kamu (contoh: username):", { parse_mode: "HTML" });
    return;
  }
  if (step === "await_workers_subdomain") {
    user.workers_subdomain = text;
    userState[chatId] = {};
    bot.sendMessage(chatId, "✅ Akun berhasil disimpan! Pilih menu di bawah.", {
      parse_mode: "HTML",
      ...mainMenu()
    });
    return;
  }

  // 2. Deploy Worker - Step by Step
  if (step === "deploy_worker_name") {
    userState[chatId] = { step: "deploy_worker_code", worker_name: text };
    bot.sendMessage(chatId, "✏️ Kirim kode JavaScript <b>Worker</b> kamu <i>atau upload file .js</i>:", { parse_mode: "HTML" });
    return;
  }
  if (step === "deploy_worker_code") {
    const worker_name = userState[chatId].worker_name;
    await deployWorker(chatId, user, worker_name, text);
    userState[chatId] = {};
    return;
  }

  // 3. Binding KV - Step by Step
  if (step === "binding_kv_worker") {
    userState[chatId] = { step: "binding_kv_var", worker_name: text };
    bot.sendMessage(chatId, "🔑 Masukkan <b>nama variable binding</b> (contoh: MY_KV):", { parse_mode: "HTML" });
    return;
  }
  if (step === "binding_kv_var") {
    userState[chatId] = { ...userState[chatId], step: "binding_kv_ns", binding_var: text };
    bot.sendMessage(chatId, "🗂️ Masukkan <b>Namespace ID</b> KV Storage yang ingin di-bind:", { parse_mode: "HTML" });
    return;
  }
  if (step === "binding_kv_ns") {
    const { worker_name, binding_var } = userState[chatId];
    await bindingKV(chatId, user, worker_name, binding_var, text);
    userState[chatId] = {};
    return;
  }

  // 4. Unbind KV - Step by Step
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

// ---- UPLOAD FILE JS UNTUK DEPLOY WORKER ----
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];
  if (!state || state.step !== "deploy_worker_code") {
    bot.sendMessage(chatId, "⚠️ Kirim file JS hanya saat proses deploy Worker ya.");
    return;
  }
  const worker_name = state.worker_name;
  const user = getUser(chatId);
  const fileId = msg.document.file_id;
  if (!msg.document.file_name.endsWith('.js')) {
    bot.sendMessage(chatId, "❌ Hanya file <b>.js</b> yang didukung.", { parse_mode: "HTML" });
    return;
  }
  try {
    const fileLink = await bot.getFileLink(fileId);
    const res = await fetch(fileLink);
    const code = await res.text();
    await deployWorker(chatId, user, worker_name, code);
    userState[chatId] = {};
  } catch (e) {
    bot.sendMessage(chatId, "❌ Gagal membaca file dari Telegram.");
  }
});

// ---- CALLBACK HANDLER ----
bot.on('callback_query', async (query) => {
  const chatId = query.from.id;
  const data = query.data;
  const user = getUser(chatId);

  if (data === "main_menu") {
    bot.editMessageText(welcomeMessage(), { chat_id: chatId, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    return bot.answerCallbackQuery(query.id);
  }

  if (data === "deploy_worker") {
    userState[chatId] = { step: "deploy_worker_name" };
    bot.sendMessage(chatId, "🏷️ Masukkan <b>nama Worker</b> yang ingin dibuat:", { parse_mode: "HTML" });
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
    bot.sendMessage(chatId, ok ? `✅ Worker <b>${name}</b> berhasil dihapus.` : `❌ Gagal menghapus worker <b>${name}</b>.`, { parse_mode: "HTML" });
    return bot.answerCallbackQuery(query.id);
  }

  // Binding KV
  if (data === "binding_kv") {
    userState[chatId] = { step: "binding_kv_worker" };
    bot.sendMessage(chatId, "🏷️ Masukkan <b>nama Worker</b> yang ingin di-binding KV:", { parse_mode: "HTML" });
    return bot.answerCallbackQuery(query.id);
  }

  // Unbind KV
  if (data === "unbind_kv") {
    userState[chatId] = { step: "unbind_kv_worker" };
    bot.sendMessage(chatId, "🏷️ Masukkan <b>nama Worker</b> yang ingin di-unbinding KV:", { parse_mode: "HTML" });
    return bot.answerCallbackQuery(query.id);
  }
  if (data.startsWith("unbind_kv_confirm:")) {
    const [, worker_name, binding_name] = data.split(":");
    const ok = await unbindingKV(chatId, user, worker_name, binding_name);
    bot.sendMessage(chatId, ok ? `✅ Binding <b>${binding_name}</b> berhasil dihapus dari Worker <b>${worker_name}</b>.` : `❌ Gagal hapus binding.`, { parse_mode: "HTML" });
    return bot.answerCallbackQuery(query.id);
  }

  // List Worker KV
  if (data === "list_worker_kv") {
    await listWorkerKV(chatId, user);
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
    if (data.success) {
      let workerUrl = user.workers_subdomain ? `https://${name}.${user.workers_subdomain}.workers.dev` : "(isi subdomain di akun dulu)";
      bot.sendMessage(chatId,
        `<b>✅ Worker <u>${name}</u> berhasil di-deploy!</b>\n\n` +
        `🌍 <b>URL Worker:</b> <a href="${workerUrl}">${workerUrl}</a>\n\n` +
        `<i>Silakan akses URL di atas untuk melihat hasilnya.</i>`,
        { parse_mode: "HTML", disable_web_page_preview: true }
      );
    } else {
      bot.sendMessage(chatId, `❌ Gagal deploy: ${JSON.stringify(data.errors)}`);
    }
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
  const subdomain = user.workers_subdomain || "";
  const url = `${API_BASE}/${user.account_id}/workers/scripts`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { "Authorization": `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (!data.success) return bot.sendMessage(chatId, "❌ Gagal ambil daftar worker.");
    if (!data.result.length) return bot.sendMessage(chatId, "📭 Belum ada worker di akun Cloudflare-mu.");
    let list = data.result.map(w =>
      subdomain
        ? `• <b>${w.id}</b> — <a href="https://${w.id}.${subdomain}.workers.dev">${w.id}.${subdomain}.workers.dev</a>`
        : `• <b>${w.id}</b>`
    ).join('\n');
    bot.sendMessage(chatId, `<b>📝 Daftar Worker:</b>\n${list}`, {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
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
    bot.sendMessage(chatId, putData.success ? `✅ Binding KV <b>${binding_var}</b> berhasil ditambahkan ke Worker <b>${worker_name}</b>.` : `❌ Gagal binding: ${JSON.stringify(putData.errors)}`, { parse_mode: "HTML" });
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

// ---- LIST WORKER YANG ADA KV BINDING ----
async function listWorkerKV(chatId, user) {
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

    let reply = `<b>🔍 Daftar Worker yang punya Binding KV:</b>\n`;
    let found = false;
    const subdomain = user.workers_subdomain || "";
    for (const w of data.result) {
      // Ambil detail worker (bindings)
      const detailUrl = `${API_BASE}/${user.account_id}/workers/scripts/${w.id}`;
      try {
        const resDetail = await fetch(detailUrl, {
          method: 'GET',
          headers: { "Authorization": `Bearer ${user.token}` }
        });
        const detail = await resDetail.json();
        if (detail.success && detail.result && detail.result.bindings) {
          const kvBindings = detail.result.bindings.filter(b => b.type === "kv_namespace");
          if (kvBindings.length) {
            found = true;
            reply += `\n• <b>${w.id}</b>${subdomain ? ` (<a href="https://${w.id}.${subdomain}.workers.dev">link</a>)` : ""}:\n  - ${kvBindings.map(b => `<code>${b.name}</code>`).join('\n  - ')}\n`;
          }
        }
      } catch {}
    }
    if (!found) {
      bot.sendMessage(chatId, "📭 Tidak ada worker yang punya binding KV.");
    } else {
      bot.sendMessage(chatId, reply, { parse_mode: "HTML", disable_web_page_preview: true });
    }
  } catch (e) {
    bot.sendMessage(chatId, "❌ Error koneksi ke Cloudflare API.");
  }
}
