// Helper untuk panggil Telegram Bot API via Lovable Connector Gateway
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

function getKeys() {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY is not configured");
  return { LOVABLE_API_KEY, TELEGRAM_API_KEY };
}

async function tgFetch(path: string, body: Record<string, unknown>) {
  const { LOVABLE_API_KEY, TELEGRAM_API_KEY } = getKeys();
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
  if (!res.ok) {
    throw new Error(`Telegram API ${path} failed [${res.status}]: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function sendMessage(chatId: number, text: string, opts: Record<string, unknown> = {}) {
  return tgFetch("/sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...opts,
  });
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

export async function getUpdates(offset: number, timeout = 50) {
  return tgFetch("/getUpdates", {
    offset,
    timeout,
    allowed_updates: ["message"],
  });
}
