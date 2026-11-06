const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function telegram(method, data) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return r.json();
}

async function db(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}

async function reply(chatId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Mawzz Share Bot aktif");
  }

  const msg = req.body?.message;
  if (!msg?.text) return res.status(200).send("OK");

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id);
  const text = msg.text.trim();

  // Catat grup yang mengundang bot.
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    await db("telegram_groups?on_conflict=chat_id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        chat_id: String(chatId),
        group_name: msg.chat.title || "Telegram Group"
      })
    });
  }

  // Perintah admin hanya di chat pribadi.
  if (userId !== ADMIN_ID || msg.chat.type !== "private") {
    return res.status(200).send("OK");
  }

  if (text === "/start") {
    await reply(chatId,
      "Mawzz Share Bot aktif!\n\n/share teks\n/listgroup\n/help"
    );
  }

  else if (text === "/help") {
    await reply(chatId,
      "/share teks - Bagikan pesan ke grup terdaftar\n" +
      "/listgroup - Lihat daftar grup\n" +
      "/help - Bantuan"
    );
  }

  else if (text === "/listgroup") {
    const r = await db("telegram_groups?select=chat_id,group_name");
    const groups = await r.json();

    if (!Array.isArray(groups) || groups.length === 0) {
      await reply(chatId, "Belum ada grup terdaftar.");
    } else {
      await reply(chatId,
        "Grup terdaftar:\n" +
        groups.map((g, i) =>
          `${i + 1}. ${g.group_name} (${g.chat_id})`
        ).join("\n")
      );
    }
  }

  else if (text.startsWith("/share ")) {
    const message = text.slice(7).trim();

    if (!message) {
      await reply(chatId, "Format: /share teks");
      return res.status(200).send("OK");
    }

    const r = await db("telegram_groups?select=chat_id");
    const groups = await r.json();

    if (!Array.isArray(groups) || groups.length === 0) {
      await reply(chatId, "Belum ada grup terdaftar.");
      return res.status(200).send("OK");
    }

    let sent = 0;
    let failed = 0;

    // Batas 10 grup per perintah, dengan jeda.
    for (const group of groups.slice(0, 10)) {
      const result = await telegram("sendMessage", {
        chat_id: group.chat_id,
        text: message
      });

      if (result.ok) sent++;
      else failed++;

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    await reply(chatId,
      `Selesai.\nBerhasil: ${sent}\nGagal: ${failed}`
    );
  }

  return res.status(200).send("OK");
}
