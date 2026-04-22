// AI Companion — special "virtual partner" attached to a real user when no human match found.
// Implementation: we use a sentinel UUID stored in profiles as the AI partner. Conversations
// where user_b == AI_PROFILE_ID are considered AI sessions. Incoming user messages route to
// Lovable AI gateway and reply is sent back to the user via Telegram.

import { chatComplete } from "./ai.ts";
import { safeSend } from "./telegram.ts";
import { getSupabase } from "./processor.ts";

// Sentinel telegram_user_id for AI companion. Negative & out-of-range to never collide with real Telegram IDs.
export const AI_TELEGRAM_USER_ID = -777_000_777;
export const AI_TELEGRAM_CHAT_ID = -777_000_777;
export const AI_ALIAS = "AI Companion";

let cachedAiProfileId: string | null = null;

export async function ensureAiProfile(supabase: ReturnType<typeof getSupabase>): Promise<string> {
  if (cachedAiProfileId) return cachedAiProfileId;
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("telegram_user_id", AI_TELEGRAM_USER_ID)
    .maybeSingle();
  if (existing) {
    cachedAiProfileId = existing.id;
    return existing.id;
  }
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      telegram_user_id: AI_TELEGRAM_USER_ID,
      telegram_chat_id: AI_TELEGRAM_CHAT_ID,
      alias: AI_ALIAS,
      gender: "other",
      gender_preference: "any",
      province_code: null,
      province_name: "AI",
      bio: "Virtual companion saat user nyata sedang sepi.",
      onboarding_completed: true,
      trust_score: 100,
    })
    .select("id")
    .single();
  if (error) throw error;
  cachedAiProfileId = created.id;
  return created.id;
}

export function isAiProfileId(id: string): boolean {
  return cachedAiProfileId === id;
}

export async function isAiConversation(
  supabase: ReturnType<typeof getSupabase>,
  conv: { user_a: string; user_b: string },
): Promise<{ ai: boolean; aiId: string }> {
  const aiId = await ensureAiProfile(supabase);
  return { ai: conv.user_a === aiId || conv.user_b === aiId, aiId };
}

const SYSTEM_PROMPT =
  "Kamu adalah teman virtual di aplikasi chat anonim 'Rizztalk' (Indonesia). " +
  "Bersikap ramah, santai, kasual seperti teman sebaya, gunakan Bahasa Indonesia natural " +
  "(boleh sesekali campur slang ringan), jawaban PENDEK 1-2 kalimat saja. " +
  "Tanyakan balik untuk menjaga obrolan. JANGAN berpura-pura jadi manusia: " +
  "kalau ditanya 'kamu bot/AI?', jawab jujur kamu adalah AI Companion. " +
  "Tolak permintaan: nomor HP, transfer uang, link mencurigakan, konten seksual eksplisit, " +
  "atau pelecehan. Hindari emoji berlebihan (max 1 per balasan).";

export async function aiReply(
  supabase: ReturnType<typeof getSupabase>,
  conversationId: string,
  userId: string,
  userChatId: number,
  userText: string,
): Promise<void> {
  // Build short context window (last 12 messages)
  const { data: history } = await supabase
    .from("messages")
    .select("sender_id, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);

  const ordered = (history ?? []).slice().reverse();
  const aiId = await ensureAiProfile(supabase);

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...ordered.map((m) => ({
      role: (m.sender_id === aiId ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content).slice(0, 600),
    })),
    { role: "user" as const, content: userText.slice(0, 600) },
  ];

  let reply = "";
  try {
    const res = await chatComplete({
      messages,
      model: "google/gemini-2.5-flash",
      temperature: 0.85,
      maxTokens: 160,
    });
    reply = res.content.trim();
  } catch (e: unknown) {
    const err = e as { kind?: string };
    if (err?.kind === "rate_limit") {
      reply = "Bentar ya, lagi rame banget. Coba kirim lagi sebentar lagi 🙏";
    } else if (err?.kind === "payment") {
      reply = "Maaf, AI Companion lagi istirahat. Coba /cari lagi nanti.";
    } else {
      console.error("aiReply failed", e);
      reply = "Hmm, koneksi ke aku lagi nggak stabil. Coba kirim lagi?";
    }
  }
  if (!reply) reply = "Maaf, aku belum bisa jawab itu. Cerita hal lain dong?";

  // Add a tiny "thinking" delay to feel natural (300-900ms based on length)
  const delay = Math.min(900, 300 + reply.length * 8);
  await new Promise((r) => setTimeout(r, delay));

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: aiId,
    content: reply,
  });

  await safeSend(userChatId, reply);
}
