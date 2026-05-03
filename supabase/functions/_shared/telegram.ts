// Helper untuk panggil Telegram Bot API via Lovable Connector Gateway
// Mendukung: sendMessage, sendKeyboard, removeKeyboard, sendPhoto, getUpdates
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function getKeys() {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY is not configured");
  return { LOVABLE_API_KEY, TELEGRAM_API_KEY };
}

async function tgFetch(path: string, body: Record<string, unknown>, retries = 2) {
  const { LOVABLE_API_KEY, TELEGRAM_API_KEY } = getKeys();
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GATEWAY_URL}${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": TELEGRAM_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) return data;
      // Retry only on 5xx/transient gateway errors
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`Telegram API ${path} failed [${res.status}]: ${JSON.stringify(data)}`);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(`Telegram API ${path} failed [${res.status}]: ${JSON.stringify(data)}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt >= retries) throw lastErr;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("tgFetch exhausted retries");
}

export async function sendMessage(chatId: number, text: string, opts: Record<string, unknown> = {}) {
  try {
    return await tgFetch("/sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...opts,
    });
  } catch (err) {
    // Fallback: kirim sebagai plain text kalau HTML parse error / gateway hiccup
    console.error(`sendMessage HTML failed, retrying plain: ${err instanceof Error ? err.message : err}`);
    const plain = text.replace(/<[^>]+>/g, "");
    return tgFetch("/sendMessage", {
      chat_id: chatId,
      text: plain,
      disable_web_page_preview: true,
      ...opts,
    });
  }
}

export async function sendKeyboard(chatId: number, text: string, keyboard: string[][], opts: Record<string, unknown> = {}) {
  return sendMessage(chatId, text, {
    reply_markup: {
      keyboard: keyboard.map(row => row.map(label => ({ text: label }))),
      resize_keyboard: true,
      one_time_keyboard: true,
    },
    ...opts,
  });
}

export async function removeKeyboard(chatId: number, text: string) {
  return sendMessage(chatId, text, { reply_markup: { remove_keyboard: true } });
}

// Inline keyboard (tombol di dalam pesan, bukan popup di bawah).
// `keyboard` = matrix of {text, callback_data} pairs.
export type InlineButton = { text: string; callback_data: string };
export async function sendInlineKeyboard(
  chatId: number,
  text: string,
  keyboard: InlineButton[][],
  opts: Record<string, unknown> = {},
) {
  return sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard },
    ...opts,
  });
}

// Acknowledge a callback query (hilangkan loading spinner di tombol).
export async function answerCallbackQuery(
  callbackQueryId: string,
  text = "",
  showAlert = false,
) {
  try {
    return await tgFetch("/answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
      show_alert: showAlert,
    });
  } catch (err) {
    console.error(`answerCallbackQuery failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Edit message reply markup (mis. hilangkan tombol setelah dipencet).
export async function editMessageReplyMarkup(
  chatId: number,
  messageId: number,
  keyboard: InlineButton[][] | null = null,
) {
  try {
    return await tgFetch("/editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard ? { inline_keyboard: keyboard } : { inline_keyboard: [] },
    });
  } catch (err) {
    console.error(`editMessageReplyMarkup failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Set bot's command list — populates the "Menu" button (next to message input).
export async function setBotCommands(commands: { command: string; description: string }[]) {
  return tgFetch("/setMyCommands", { commands });
}

// Tahan-error: kirim pesan tanpa pernah melempar (mis. user blokir bot, chat_id invalid).
// Mengembalikan true jika sukses, false jika gagal — dipakai saat notifikasi ke kedua pihak
// agar kegagalan ke salah satu user tidak mempengaruhi pengiriman ke user lain.
export async function safeSend(chatId: number | null | undefined, text: string): Promise<boolean> {
  if (!chatId || !Number.isFinite(Number(chatId))) {
    console.warn(`safeSend skipped: invalid chat_id=${chatId}`);
    return false;
  }
  try {
    await sendMessage(Number(chatId), text);
    return true;
  } catch (err) {
    console.error(`safeSend to ${chatId} failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// Kirim foto (gambar QRIS) ke chat. `photo` bisa berupa URL publik atau file_id Telegram.
export async function sendPhoto(
  chatId: number,
  photo: string,
  caption = "",
  opts: Record<string, unknown> = {},
) {
  try {
    return await tgFetch("/sendPhoto", {
      chat_id: chatId,
      photo,
      ...(caption ? { caption, parse_mode: "HTML" } : {}),
      ...opts,
    });
  } catch (err) {
    // Fallback: kirim caption saja jika foto gagal
    console.error(`sendPhoto failed, falling back to text: ${err instanceof Error ? err.message : err}`);
    if (caption) {
      return sendMessage(chatId, caption);
    }
    throw err;
  }
}

export async function getUpdates(offset: number, timeout = 50) {
  return tgFetch("/getUpdates", {
    offset,
    timeout,
    allowed_updates: ["message", "callback_query"],
  });
}

// Ambil metadata file (untuk dapat file_path) berdasarkan file_id Telegram.
export async function getFile(fileId: string): Promise<{ file_path: string; file_size?: number } | null> {
  try {
    const res = await tgFetch("/getFile", { file_id: fileId });
    return res?.result ?? null;
  } catch (err) {
    console.error(`getFile failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Download file Telegram via gateway, return base64 + mime.
export async function downloadTelegramFile(fileId: string): Promise<{ base64: string; mime: string } | null> {
  const meta = await getFile(fileId);
  if (!meta?.file_path) return null;
  const { LOVABLE_API_KEY, TELEGRAM_API_KEY } = getKeys();
  try {
    const res = await fetch(`${GATEWAY_URL}/file/${meta.file_path}`, {
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
      },
    });
    if (!res.ok) {
      console.error(`downloadTelegramFile HTTP ${res.status}`);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);
    const ext = meta.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { base64, mime };
  } catch (err) {
    console.error(`downloadTelegramFile failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
