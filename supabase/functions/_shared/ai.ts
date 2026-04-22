// Lovable AI Gateway helper — used by AI companion (chat) and bot detection (classification).
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AIError = { kind: "rate_limit" | "payment" | "other"; message: string; status?: number };

function getKey(): string {
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) throw new Error("LOVABLE_API_KEY not configured");
  return k;
}

export async function chatComplete(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{ content: string }> {
  const key = getKey();
  const body = {
    model: opts.model ?? "google/gemini-2.5-flash",
    messages: opts.messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 200,
    stream: false,
  };
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) {
      const e: AIError = { kind: "rate_limit", message: "AI rate limit", status: 429 };
      throw e;
    }
    if (res.status === 402) {
      const e: AIError = { kind: "payment", message: "AI credits exhausted", status: 402 };
      throw e;
    }
    throw new Error(`AI gateway ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return { content: typeof content === "string" ? content : String(content) };
}

// Structured classification via tool calling.
export async function classifyMessage(text: string): Promise<{
  is_bot: boolean;
  is_spam: boolean;
  is_scam: boolean;
  is_nsfw: boolean;
  confidence: number;
  reason: string;
}> {
  const key = getKey();
  const body = {
    model: "google/gemini-2.5-flash-lite",
    messages: [
      {
        role: "system",
        content:
          "Kamu adalah classifier konten chat anonim Indonesia. Klasifikasikan satu pesan singkat. " +
          "Spam = promosi/link berulang. Scam = minta uang/transfer/judi/iming-iming. " +
          "Bot = jawaban otomatis tidak nyambung/template. NSFW = pelecehan seksual/eksplisit. " +
          "Confidence 0..1.",
      },
      { role: "user", content: `Pesan:\n"""\n${text.slice(0, 1000)}\n"""` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "classify",
          description: "Return classification flags",
          parameters: {
            type: "object",
            properties: {
              is_bot: { type: "boolean" },
              is_spam: { type: "boolean" },
              is_scam: { type: "boolean" },
              is_nsfw: { type: "boolean" },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
            required: ["is_bot", "is_spam", "is_scam", "is_nsfw", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "classify" } },
    temperature: 0,
  };
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI classify ${res.status}: ${t}`);
  }
  const data = await res.json();
  const args =
    data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI classify: no tool_call");
  const parsed = typeof args === "string" ? JSON.parse(args) : args;
  return {
    is_bot: !!parsed.is_bot,
    is_spam: !!parsed.is_spam,
    is_scam: !!parsed.is_scam,
    is_nsfw: !!parsed.is_nsfw,
    confidence: Number(parsed.confidence ?? 0),
    reason: String(parsed.reason ?? ""),
  };
}
