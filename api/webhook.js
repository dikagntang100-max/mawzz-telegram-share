const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID);
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

async function sendMedia(chatId, media) {
  const data = {
    chat_id: chatId,
    caption: media.caption || ""
  };

  if (media.photo) {
    data.photo = media.photo.at(-1).file_id;
    return telegram("sendPhoto", data);
  }

  if (media.video) {
    data.video = media.video.file_id;
    return telegram("sendVideo", data);
  }

  if (media.audio) {
    data.audio = media.audio.file_id;
    return telegram("sendAudio", data);
  }

  if (media.document) {
    data.document = media.document.file_id;
    return telegram("sendDocument", data);
  }

  if (media.voice) {
    data.voice = media.voice.file_id;
    return telegram("sendVoice", data);
  }

  if (media.animation) {
    data.animation = media.animation.file_id;
    return telegram("sendAnimation", data);
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Mawzz Share Bot Media Aktif");
  }

  const msg = req.body?.message;
  if (!msg) return res.status(200).send("OK");

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || "");
  const isPrivate = msg.chat.type === "private";
  const text = (msg.text || "").trim();

  if (
    msg.chat.type === "group" ||
    msg.chat.type === "supergroup"
  ) {
    if (text === "/start@BudiShare_bot") {
      const r = await db("telegram_groups?on_conflict=chat_id", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          chat_id: String(chatId),
          group_name: msg.chat.title || "Telegram Group"
        })
      });

      if (!r.ok) {
        console.error("Database error:", await r.text());
      }
    }

    return res.status(200).send("OK");
  }

  if (!isPrivate || userId !== ADMIN_ID) {
    return res.status(200).send("OK");
  }

  if (text === "/start") {
    await reply(chatId,
      "Mawzz Share Bot Media aktif!\n\n" +
      "Kirim foto, video, lagu, atau file terlebih dahulu.\n" +
      "Lalu gunakan /share untuk membagikannya.\n\n" +
      "/listgroup - Daftar grup\n" +
      "/cancel - Batalkan media"
    );
  }

  else if (text === "/help") {
    await reply(chatId,
      "Cara menggunakan:\n" +
      "1. Kirim media ke bot.\n" +
      "2. Tambahkan caption jika perlu.\n" +
      "3. Kirim /share.\n\n" +
      "/listgroup - Daftar grup\n" +
      "/cancel - Batalkan media"
    );
  }

  else if (text === "/listgroup") {
    const r = await db("telegram_groups?select=chat_id,group_name");
    const groups = await r.json();

    if (!r.ok || !Array.isArray(groups) || !groups.length) {
      await reply(chatId, "Belum ada grup terdaftar.");
    } else {
      await reply(chatId,
        "Grup terdaftar:\n" +
        groups.map((g, i) =>
          `${i + 1}. ${g.group_name}`
        ).join("\n")
      );
    }
  }

  else if (text === "/cancel") {
    await db(`telegram_pending_media?admin_id=eq.${userId}`, {
      method: "DELETE"
    });
    await reply(chatId, "Media dibatalkan.");
  }

  else if (text === "/share") {
    const r = await db(
      `telegram_pending_media?admin_id=eq.${userId}&select=media`
    );

    const pending = await r.json();
    const media = pending?.[0]?.media;

    if (!media) {
      await reply(chatId, "Kirim media terlebih dahulu.");
      return res.status(200).send("OK");
    }

    const gr = await db("telegram_groups?select=chat_id");
    const groups = await gr.json();

    if (!gr.ok || !Array.isArray(groups) || !groups.length) {
      await reply(chatId, "Belum ada grup terdaftar.");
      return res.status(200).send("OK");
    }

    let sent = 0;
    let failed = 0;

    for (const group of groups.slice(0, 10)) {
      const result = await sendMedia(group.chat_id, media);
      if (result?.ok) sent++;
      else failed++;

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    await db(`telegram_pending_media?admin_id=eq.${userId}`, {
      method: "DELETE"
    });

    await reply(chatId,
      `Pengiriman selesai.\nBerhasil: ${sent}\nGagal: ${failed}`
    );
  }

  else if (
    msg.photo || msg.video || msg.audio ||
    msg.document || msg.voice || msg.animation
  ) {
    const media = {
      caption: msg.caption || "",
      photo: msg.photo,
      video: msg.video,
      audio: msg.audio,
      document: msg.document,
      voice: msg.voice,
      animation: msg.animation
    };

    const r = await db("telegram_pending_media?on_conflict=admin_id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        admin_id: userId,
        media
      })
    });

    if (!r.ok) {
      await reply(chatId, "Gagal menyimpan media. Periksa database.");
    } else {
      await reply(chatId,
        "Media berhasil disimpan!\nKirim /share untuk membagikan."
      );
    }
  }

  else if (text.startsWith("/share ")) {
    await reply(chatId,
      "Untuk membagikan teks, gunakan fitur versi teks yang sudah dikonfigurasi."
    );
  }

  return res.status(200).send("OK");
                      }
