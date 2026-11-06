const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId, text) {
  return fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Mawzz Share Bot aktif");
  }

  const update = req.body;
  const msg = update.message;

  if (!msg || !msg.text) {
    return res.status(200).send("OK");
  }

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text.trim();

  if (userId !== ADMIN_ID) {
    return res.status(200).send("OK");
  }

  if (text.startsWith("/start")) {
    await sendMessage(chatId,
      "Mawzz Share Bot aktif!\n/share teks\n/listgroup\n/help"
    );
  }

  else if (text.startsWith("/share ")) {
    const message = text.slice(7).trim();

    if (!message) {
      await sendMessage(chatId, "Masukkan pesan setelah /share");
      return res.status(200).send("OK");
    }

    await sendMessage(chatId,
      "Pesan siap dibagikan. Gunakan daftar grup yang telah didaftarkan."
    );
  }

  else if (text === "/help") {
    await sendMessage(chatId,
      "/share teks - Buat pesan\n/listgroup - Daftar grup"
    );
  }

  return res.status(200).send("OK");
}
