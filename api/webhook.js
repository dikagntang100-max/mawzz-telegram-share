const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function telegram(method, data = {}) {
  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );
  return r.json();
}

async function db(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });

  const data = await r.text();
  if (!r.ok) throw new Error(data);
  return data ? JSON.parse(data) : [];
}

async function reply(chatId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text
  });
}

async function savePending(media) {
  return db("telegram_pending_media?on_conflict=admin_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      admin_id: ADMIN_ID,
      media
    })
  });
}

async function getPending() {
  const rows = await db(
    `telegram_pending_media?admin_id=eq.${ADMIN_ID}&select=media`
  );
  return rows[0]?.media || null;
}

async function clearPending() {
  return db(
    `telegram_pending_media?admin_id=eq.${ADMIN_ID}`,
    { method: "DELETE" }
  );
}

async function sendContent(chatId, media) {
  if (media.type === "text") {
    return telegram("sendMessage", {
      chat_id: chatId,
      text: media.text
    });
  }

  const methods = {
    photo: "sendPhoto",
    video: "sendVideo",
    audio: "sendAudio",
    document: "sendDocument",
    voice: "sendVoice",
    animation: "sendAnimation"
  };

  const method = methods[media.type];
  if (!method) throw new Error("Jenis media tidak didukung");

  return telegram(method, {
    chat_id: chatId,
    [media.type]: media.file_id,
    caption: media.caption || ""
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    const update = req.body;

    // OTOMATIS MENDAFTARKAN GRUP
    if (update?.my_chat_member) {
      const event = update.my_chat_member;
      const chat = event.chat;
      const status = event.new_chat_member.status;

      if (!["group", "supergroup"].includes(chat.type)) {
        return res.status(200).send("OK");
      }

      if (["member", "administrator"].includes(status)) {
        const actor = await telegram("getChatMember", {
          chat_id: chat.id,
          user_id: event.from.id
        });

        if (
          actor.ok &&
          ["creator", "administrator"].includes(actor.result.status)
        ) {
          await db("telegram_groups?on_conflict=chat_id", {
            method: "POST",
            headers: {
              Prefer: "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify({
              chat_id: String(chat.id),
              group_name: chat.title || "Telegram Group"
            })
          });

          await reply(
            chat.id,
            "Bot berhasil aktif! Grup sudah terdaftar."
          );
        }
      }

      if (["left", "kicked"].includes(status)) {
        await db(
          `telegram_groups?chat_id=eq.${encodeURIComponent(String(chat.id))}`,
          { method: "DELETE" }
        );
      }

      return res.status(200).send("OK");
    }

    const msg = update?.message;
    if (!msg) return res.status(200).send("OK");

    const chatId = msg.chat.id;
    const userId = String(msg.from?.id || "");
    const isPrivate = msg.chat.type === "private";

    // HANYA ADMIN DI CHAT PRIBADI
    if (!isPrivate || userId !== ADMIN_ID) {
      return res.status(200).send("OK");
    }

    const text = (msg.text || "").trim();

    if (text === "/start") {
      await reply(chatId,
        "BOT SHARE AKTIF\n\n" +
        "/addgroup - Tambah grup\n" +
        "/listgroup - Daftar grup\n" +
        "/leavegroup - Keluar grup\n" +
        "/share teks - Bagikan teks\n" +
        "/share - Bagikan media tersimpan\n" +
        "/cancel - Batalkan pesan"
      );
    }

    else if (text === "/help") {
      await reply(chatId,
        "CARA SHARE:\n\n" +
        "Teks: /share Halo semua\n\n" +
        "Media: Kirim foto/video/file ke bot, lalu ketik /share.\n\n" +
        "Gunakan /cancel untuk membatalkan."
      );
    }

    else if (text === "/addgroup") {
      await reply(chatId,
        "MENU TAMBAH GRUP\n\n" +
        "1. Buka grup Telegram.\n" +
        "2. Tambahkan @BudiShare_bot.\n" +
        "3. Pastikan kamu admin grup.\n" +
        "4. Grup otomatis terdaftar.\n\n" +
        "Tidak perlu perintah aktivasi di grup."
      );
    }

    else if (text === "/listgroup") {
      const groups = await db(
        "telegram_groups?select=chat_id,group_name&order=added_at.desc"
      );

      if (!groups.length) {
        await reply(chatId, "Belum ada grup terdaftar.");
      } else {
        const list = groups.map((g, i) =>
          `${i + 1}. ${g.group_name}\nID: ${g.chat_id}`
        ).join("\n\n");

        await reply(chatId, "DAFTAR GRUP:\n\n" + list);
      }
    }

    else if (text === "/leavegroup") {
      const groups = await db(
        "telegram_groups?select=chat_id,group_name"
      );

      if (!groups.length) {
        await reply(chatId, "Belum ada grup.");
      } else {
        const list = groups.map((g, i) =>
          `${i + 1}. ${g.group_name}`
        ).join("\n");

        await reply(chatId,
          "Ketik /leavegroup nomor\n\n" + list
        );
      }
    }

    else if (text.startsWith("/leavegroup ")) {
      const number = Number(text.split(" ")[1]);

      const groups = await db(
        "telegram_groups?select=chat_id,group_name&order=added_at.desc"
      );

      const group = groups[number - 1];

      if (!group) {
        await reply(chatId, "Nomor grup tidak ditemukan.");
      } else {
        const result = await telegram("leaveChat", {
          chat_id: group.chat_id
        });

        if (result.ok) {
          await db(
            `telegram_groups?chat_id=eq.${encodeURIComponent(group.chat_id)}`,
            { method: "DELETE" }
          );
          await reply(chatId, `Bot keluar dari ${group.group_name}.`);
        } else {
          await reply(chatId, "Gagal keluar: " + result.description);
        }
      }
    }

    else if (text === "/cancel") {
      await clearPending();
      await reply(chatId, "Pesan yang disiapkan dibatalkan.");
    }

    else if (text.startsWith("/share ")) {
      const content = text.slice(7).trim();

      if (!content) {
        await reply(chatId, "Teks kosong.");
      } else {
        await savePending({ type: "text", text: content });
        await reply(chatId,
          "Teks siap dibagikan. Ketik /share untuk mengirim."
        );
      }
    }

    else if (text === "/share") {
      const media = await getPending();

      if (!media) {
        await reply(chatId,
          "Belum ada pesan. Kirim teks atau media terlebih dahulu."
        );
      } else {
        const groups = await db(
          "telegram_groups?select=chat_id,group_name"
        );

        if (!groups.length) {
          await reply(chatId, "Belum ada grup terdaftar.");
        } else {
          let success = 0;
          let failed = 0;

          // Batasi 10 grup per pengiriman
          for (const group of groups.slice(0, 10)) {
            try {
              const result = await sendContent(group.chat_id, media);
              if (result.ok) success++;
              else failed++;
            } catch {
              failed++;
            }

            await new Promise(resolve => setTimeout(resolve, 1500));
          }

          await clearPending();

          await reply(chatId,
            `SELESAI\nBerhasil: ${success}\nGagal: ${failed}`
          );
        }
      }
    }

    // TERIMA MEDIA DARI ADMIN
    else {
      let media = null;

      if (msg.photo?.length) {
        media = {
          type: "photo",
          file_id: msg.photo[msg.photo.length - 1].file_id,
          caption: msg.caption || ""
        };
      } else if (msg.video) {
        media = {
          type: "video",
          file_id: msg.video.file_id,
          caption: msg.caption || ""
        };
      } else if (msg.audio) {
        media = {
          type: "audio",
          file_id: msg.audio.file_id,
          caption: msg.caption || ""
        };
      } else if (msg.document) {
        media = {
          type: "document",
          file_id: msg.document.file_id,
          caption: msg.caption || ""
        };
      } else if (msg.voice) {
        media = {
          type: "voice",
          file_id: msg.voice.file_id
        };
      } else if (msg.animation) {
        media = {
          type: "animation",
          file_id: msg.animation.file_id,
          caption: msg.caption || ""
        };
      } else if (text && !text.startsWith("/")) {
        media = { type: "text", text };
      }

      if (media) {
        await savePending(media);
        await reply(chatId,
          "Pesan tersimpan. Ketik /share untuk membagikan atau /cancel untuk membatalkan."
        );
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(200).send("OK");
  }
}
