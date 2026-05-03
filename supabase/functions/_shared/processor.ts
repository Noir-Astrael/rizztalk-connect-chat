// Shared Telegram update processor — used by both telegram-poll (cron) and telegram-webhook (instant).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendMessage, sendKeyboard, removeKeyboard, safeSend, sendPhoto, downloadTelegramFile, sendInlineKeyboard, answerCallbackQuery, editMessageReplyMarkup } from "./telegram.ts";
import { PROVINCES_ID, PRESET_INTERESTS, findProvinceByText } from "./provinces-id.ts";
import { ensureAiProfile, isAiConversation, aiReply, AI_TELEGRAM_USER_ID, AI_ALIAS } from "./ai-companion.ts";
import { applyDetection } from "./bot-detection.ts";

export type TgUser = { id: number; username?: string; first_name?: string; language_code?: string };
export type TgPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  date: number;
};
export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

type Profile = {
  id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  alias: string;
  gender: "male" | "female" | "other" | null;
  gender_preference: "male" | "female" | "any";
  province_code: string | null;
  province_name: string | null;
  bio: string | null;
  trust_score: number;
  is_premium: boolean;
  premium_until?: string | null;
  is_banned_until: string | null;
  onboarding_completed: boolean;
  no_ai: boolean;
  onboarding_step?: string | null;
  pending_payment_ref?: string | null;
};

type Step =
  | { name: "idle" }
  | { name: "set_alias" }
  | { name: "set_gender" }
  | { name: "set_province" }
  | { name: "set_interests" }
  | { name: "set_bio" }
  | { name: "set_gender_pref" }
  | { name: "await_report_reason"; conversationId: string; reportedId: string }
  | { name: "await_payment_proof"; referenceCode: string };

// In-memory step cache (for same invocation performance);
// authoritative state is persisted to DB (profiles.onboarding_step + pending_payment_ref)
const stepByChat = new Map<number, Step>();

async function persistStep(supabase: ReturnType<typeof getSupabase>, chatId: number, step: Step) {
  stepByChat.set(chatId, step);
  const stepName = step.name;
  const paymentRef = step.name === "await_payment_proof" ? step.referenceCode : null;
  // Store in report_reason steps as idle (report is single-message flow)
  const dbStep = step.name === "await_report_reason" ? "idle" : stepName;
  await supabase
    .from("profiles")
    .update({ onboarding_step: dbStep, pending_payment_ref: paymentRef })
    .eq("telegram_chat_id", chatId);
}

async function loadStep(supabase: ReturnType<typeof getSupabase>, chatId: number, profile: { onboarding_step?: string | null; pending_payment_ref?: string | null }): Promise<Step> {
  const cached = stepByChat.get(chatId);
  if (cached) return cached;
  // Restore from DB (handles cold-start)
  const dbStep = profile.onboarding_step;
  if (!dbStep || dbStep === "idle" || dbStep === "set_gender_pref") return { name: "idle" };
  if (dbStep === "await_payment_proof" && profile.pending_payment_ref) {
    const step: Step = { name: "await_payment_proof", referenceCode: profile.pending_payment_ref };
    stepByChat.set(chatId, step);
    return step;
  }
  const validSteps = ["set_alias", "set_gender", "set_province", "set_interests", "set_bio"] as const;
  type ValidStep = typeof validSteps[number];
  if (validSteps.includes(dbStep as ValidStep)) {
    const step: Step = { name: dbStep as ValidStep };
    stepByChat.set(chatId, step);
    return step;
  }
  return { name: "idle" };
}

// Per-conversation message counter (for AI classifier sampling)
const msgCountByConv = new Map<string, number>();

export function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key);
}

// ============= PRICING & PAYMENT =============
const PREMIUM_MONTHLY_IDR = 20_000;
// QRIS statis — set env var QRIS_IMAGE_URL di Supabase Dashboard > Edge Functions > Secrets
const QRIS_IMAGE_URL = Deno.env.get("QRIS_IMAGE_URL") ??
  "https://lrhxtsnammweqylqbsuv.supabase.co/storage/v1/object/public/qris-images//qris-payment.jpeg";
const PAYMENT_MERCHANT = Deno.env.get("PAYMENT_MERCHANT") ?? "Secret Shop";
const PAYMENT_NMID = Deno.env.get("PAYMENT_NMID") ?? "ID1026507854309";

// ============= HTML ESCAPE (untuk forward pesan antar user) =============
// Escapes user-generated text sebelum dikirim via Telegram HTML mode.
// Mencegah HTML injection dari pesan pengguna yang di-forward.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const T = {
  welcome: (alias: string) =>
    `👋 Halo <b>${alias}</b>! Selamat datang di <b>RizzTalk</b> — random chat anonim untuk Indonesia.\n\n` +
    `Berikut semua perintah yang tersedia:`,
  startCommandList:
    `<b>📋 Daftar Perintah RizzTalk</b>\n\n` +
    `🚀 <b>Mulai</b>\n` +
    `/start — mulai / lihat status\n` +
    `/profile — atur profil (gender, lokasi, minat, bio)\n\n` +
    `💬 <b>Chat</b>\n` +
    `/cari — cari teman ngobrol baru\n` +
    `/cari normal — filter trust ≥60\n` +
    `/cari terpercaya — filter trust ≥90\n` +
    `/cari sangat_terpercaya — filter trust ≥120\n` +
    `/stop — akhiri obrolan / keluar antrean\n\n` +
    `🛡️ <b>Keamanan</b>\n` +
    `/report — laporkan lawan chat (spam/asusila/bot/scam)\n` +
    `/block — blokir lawan chat agar tidak di-match lagi\n\n` +
    `👤 <b>Profil & Premium</b>\n` +
    `/me — lihat profil & riwayat trust score kamu\n` +
    `/premium — info fitur premium\n` +
    `/upgrade — upgrade premium via QRIS\n\n` +
    `🤖 <b>AI Companion</b>\n` +
    `/nonai — tolak AI Companion, hanya match manusia\n` +
    `/ai — status AI Companion & riwayat 5 pesan AI\n\n` +
    `/help — tampilkan bantuan ini lagi\n\n` +
    `<i>💡 Jika tidak ada user nyata dalam 60 detik, AI Companion akan menyapa kamu secara transparan.</i>`,
  help:
    `<b>Perintah RizzTalk</b>\n\n` +
    `/start — mulai / lihat status\n` +
    `/profile — atur profil (gender, lokasi, minat, bio)\n` +
    `/cari [filter] — cari teman ngobrol baru\n` +
    `   filter: <code>normal</code> (≥60) · <code>terpercaya</code> (≥90) · <code>sangat_terpercaya</code> (≥120)\n` +
    `   contoh: <code>/cari terpercaya</code>\n` +
    `/stop — akhiri obrolan saat ini / keluar antrean\n` +
    `/report — laporkan lawan chat (spam/asusila/bot/scam)\n` +
    `/block — blokir lawan chat agar tidak di-match lagi\n` +
    `/me — lihat profil & riwayat trust score kamu\n` +
    `/premium — upgrade premium\n` +
    `/upgrade — lihat QRIS & instruksi bayar\n` +
    `/unban [light|medium|severe] — bayar untuk unban (Rp5–15rb)\n` +
    `/unban [light|medium|severe] — bayar untuk unban (Rp5–15rb)\n` +
    `/batal — batalkan upload bukti transfer (jika salah kirim)\n` +
    `/nonai — tolak AI Companion, hanya match manusia\n` +
    `/ai — status AI Companion & riwayat 5 pesan AI\n` +
    `/help — bantuan\n\n` +
    `<i>💡 Jika tidak ada user nyata dalam 60 detik, AI Companion akan menyapa kamu (transparan, akan diberi tahu).</i>`,
  needOnboarding: `⚠️ Profil kamu belum lengkap. Ketik /profile dulu.`,
  bannedUntil: (until: string) => `🚫 Akun kamu sedang di-ban sampai <b>${until}</b>. Ketik /premium untuk info unban.`,
  searching: (sameProv: boolean, provName: string | null, filter: TrustFilter = "any", noAi = false) => {
    const base = sameProv
      ? `🔎 Mencari teman ngobrol dari <b>${provName}</b>…`
      : `🔎 Mencari teman ngobrol…`;
    const note = noAi
      ? `\n<i>⚠️ Mode /nonai aktif — AI Companion dimatikan. Kamu hanya akan di-match dengan manusia nyata.</i>`
      : `\n<i>Tunggu hingga 60 detik. Jika sepi, AI Companion akan menyapa.</i>`;
    return filter === "any" ? base + note : `${base}\n<i>Filter trust: ${trustFilterLabel(filter)} (otomatis dilonggarkan jika menunggu lama).</i>${note}`;
  },
  inQueue: `⏳ Kamu sudah di antrean. Tunggu sebentar… (max 60 detik sebelum AI Companion aktif)`,
  inQueueNoAi: `⏳ Kamu sudah di antrean (mode /nonai aktif). Hanya menunggu manusia nyata — tidak ada AI fallback.`,
  alreadyChatting: `💬 Kamu sedang dalam obrolan. Ketik /stop untuk mengakhiri.`,
  matchFound: (alias: string, provName: string, sameProv: boolean) => {
    const banner = sameProv
      ? `✅ Match ditemukan dari provinsi yang sama!`
      : `ℹ️ <i>Tidak ditemukan user dari lokasi yang sama.</i>\nKamu di-match dengan user dari provinsi lain.`;
    return `${banner}\n\n💬 Kamu sekarang ngobrol dengan <b>${alias}</b> (${provName}).\nKetik /stop untuk akhiri.`;
  },
  partnerLeft: `👋 Lawan bicara mengakhiri obrolan. Ketik /cari untuk cari yang baru.`,
  youLeft: `✅ Obrolan diakhiri. Pesan akan terhapus otomatis dari server dalam 1 jam.\nKetik /cari untuk cari yang baru.`,
  notInChat: `ℹ️ Kamu tidak sedang dalam obrolan. Ketik /cari untuk mulai.`,
  cancelled: `❎ Pencarian dibatalkan.`,
  premium: (isPremium: boolean, premiumUntil: string | null) => {
    const status = isPremium && premiumUntil
      ? `\n\n⭐ <b>Status:</b> Premium aktif sampai <b>${new Date(premiumUntil).toLocaleString("id-ID")}</b>.`
      : `\n\n<b>Status:</b> Belum premium.`;
    return `⭐ <b>Rizztalk Premium</b>\n\n` +
      `• Filter gender (cari khusus pria/wanita)\n` +
      `• Skip antrean lebih cepat\n` +
      `• Unban instan (kecuali ban berat)\n` +
      `• Prioritas matching\n\n` +
      `<b>Harga:</b> Rp ${PREMIUM_MONTHLY_IDR.toLocaleString("id-ID")} / bulan${status}\n\n` +
      `💳 Bayar via <b>QRIS</b> (Dana, GoPay, OVO, dll) — ketik <code>/upgrade</code> untuk lihat QR.`;
  },
  upgradeInstructions: (refCode: string) =>
    `💳 <b>Upgrade Premium — Bayar via QRIS</b>\n\n` +
    `Total: <b>Rp ${PREMIUM_MONTHLY_IDR.toLocaleString("id-ID")}</b>\n` +
    `Merchant: <b>${PAYMENT_MERCHANT}</b>\n` +
    `NMID: <code>${PAYMENT_NMID}</code>\n` +
    `Kode unik: <b>${refCode}</b>\n\n` +
    `<b>Cara Bayar QRIS:</b>\n` +
    `1️⃣ Buka aplikasi Dana / GoPay / OVO / m-Banking\n` +
    `2️⃣ Pilih <b>Scan QR</b> atau <b>Bayar QRIS</b>\n` +
    `3️⃣ Arahkan kamera ke gambar QR di atas\n` +
    `4️⃣ Masukkan nominal <b>Rp ${PREMIUM_MONTHLY_IDR.toLocaleString("id-ID")}</b>\n` +
    `5️⃣ Di kolom catatan / berita bayar, tulis kode: <b>${refCode}</b>\n\n` +
    `<i>⚠️ Penting: Cantumkan kode <b>${refCode}</b> di catatan transfer agar admin bisa verifikasi.</i>\n\n` +
    `Setelah bayar, kirim <b>foto bukti transfer</b> sebagai gambar ke chat ini. AI akan memverifikasi nominal otomatis.\n\n` +
    `<i>Salah kirim foto? Ketik /batal untuk membatalkan.</i>`,
  upgradeProofReceived: (refCode: string) =>
    `✅ <b>Bukti transfer diterima!</b>\n\n` +
    `📋 Detail upgrade:\n` +
    `• Kode unik: <code>${refCode}</code>\n` +
    `• Status: ⏳ <b>Menunggu verifikasi admin</b>\n` +
    `• Perkiraan: 1×24 jam\n\n` +
    `<i>Kamu akan menerima notifikasi otomatis setelah admin menyetujui atau menolak.</i>`,
  upgradeAlreadyPending: (refCode: string, hasProof: boolean) =>
    `📋 <b>Status upgrade kamu:</b>\n\n` +
    `• Kode unik: <code>${refCode}</code>\n` +
    `• Bukti: ${hasProof ? `✅ Sudah dikirim` : `❌ Belum dikirim`}\n` +
    `• Status: ⏳ Menunggu verifikasi\n` +
    `• Perkiraan: 1×24 jam\n\n` +
    (hasProof
      ? `<i>Admin sedang memproses. Kamu akan diberi tahu segera.</i>`
      : `Kirim bukti transfer (nama pengirim + jam + nominal) sebagai pesan teks sekarang.`),
  rateLimited: (bucket: string, sec: number) =>
    `⏱️ Tunggu sebentar — kamu terlalu cepat (${bucket}). Coba lagi dalam ~${sec}s.`,
  reportNoChat: `ℹ️ Kamu tidak sedang ngobrol. /report hanya bisa dipakai saat chat aktif.`,
  reportPrompt: `🚩 Pilih alasan laporan:`,
  reportSuccess: `✅ Laporan terkirim. Terima kasih sudah bantu jaga komunitas.\nObrolan otomatis diakhiri. Ketik /cari untuk cari yang baru.`,
  reportAlready: `ℹ️ Kamu sudah pernah melaporkan user ini di obrolan ini.`,
  blockNoChat: `ℹ️ Kamu tidak sedang ngobrol. /block hanya bisa dipakai saat chat aktif.`,
  blockSuccess: (alias: string) => `🚫 <b>${alias}</b> diblokir. Kalian tidak akan di-match lagi.\nObrolan diakhiri.`,
  blockNotice: `🚫 Lawan bicara mengakhiri obrolan dan memblokir kamu. Ketik /cari untuk cari yang baru.`,
  blockAlready: `ℹ️ User ini sudah ada di daftar block kamu.`,
  promptAlias: `Ketik <b>nama alias</b> kamu (3–20 karakter, akan ditampilkan ke lawan chat):`,
  promptGender: `Pilih <b>gender</b> kamu:`,
  promptProvince: `Ketik <b>nama provinsi</b> kamu (mis. "DKI Jakarta", "Jawa Barat"):`,
  promptInterests: (current: string[]) =>
    `Ketik <b>minat</b> kamu, dipisah koma. Contoh: <code>Musik, Coding, Anime</code>\n\n` +
    `Preset: ${PRESET_INTERESTS.slice(0, 12).join(", ")}, …\n\n` +
    (current.length ? `Saat ini: <i>${current.join(", ")}</i>\n\nKetik <code>skip</code> untuk lewati.` : `Ketik <code>skip</code> untuk lewati.`),
  promptBio: `Ketik <b>bio singkat</b> (maks 200 karakter), atau <code>skip</code>:`,
  profileDone: (
    p: Profile,
    interests: string[],
    history: TrustEventRow[] = [],
  ) => {
    const label = trustLabel(p.trust_score);
    const filled = Math.round((Math.min(150, Math.max(0, p.trust_score)) / 150) * 10);
    const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
    const historyBlock = history.length === 0
      ? `<i>Belum ada riwayat. Mulai chat dengan /cari!</i>`
      : history.map((h) => T.historyLine(h)).join("\n");
    const premiumLine = p.is_premium && p.premium_until
      ? `⭐ <b>Premium</b> aktif sampai ${new Date(p.premium_until).toLocaleString("id-ID")}\n`
      : "";
    return `✅ <b>Profil kamu</b>\n\n` +
      `👤 ${p.alias}\n` +
      `⚧ ${p.gender ?? "-"}\n` +
      `📍 ${p.province_name ?? "-"}\n` +
      `🎯 ${interests.length ? interests.join(", ") : "-"}\n` +
      `📝 ${p.bio ?? "-"}\n` +
      premiumLine +
      `\n⭐ <b>Trust Score</b>: <b>${p.trust_score}</b> / 150 — ${label}\n` +
      `<code>${bar}</code>\n\n` +
      `<b>📜 Riwayat trust (5 terakhir):</b>\n${historyBlock}\n\n` +
      `<b>Aturan perubahan skor:</b>\n` +
      `• /stop &lt; 30 detik → <b>−3</b> (pemutus)\n` +
      `• Chat ≥ 5 menit tanpa report → <b>+3</b> (kedua pihak)\n` +
      `• Di-report (terverifikasi) → <b>−5</b>; 5 report dlm 24 jam → ban 24 jam\n` +
      `• Di-block lawan → <b>−3</b>\n` +
      `• Bot/spam/scam terdeteksi → <b>−10</b>; severe → ban 24 jam\n` +
      `<i>Skor &lt; 70 = antrean lebih lambat. Filter trust di /cari otomatis dilonggarkan setelah 90 detik.</i>\n\n` +
      `Ketik /cari untuk mulai ngobrol!`;
  },
  trustSummary: (delta: number, newScore: number, reason: string) => {
    const sign = delta > 0 ? "+" : "";
    const emoji = delta > 0 ? "📈" : delta < 0 ? "📉" : "➖";
    const badge = trustLabel(newScore);
    return `${emoji} <b>Trust score</b>: ${sign}${delta} → <b>${newScore}</b> — ${badge}\n<i>${reason}</i>`;
  },
  reportSummaryReporter: (newScore: number) =>
    `✅ <b>Laporan terverifikasi & tercatat.</b>\n` +
    `Skor kamu tetap <b>${newScore}</b>. Terima kasih sudah bantu jaga komunitas.`,
  reportSummaryReported: (newScore: number, banned: boolean, banUntil: string | null) => {
    const head = `🚩 <b>Kamu menerima report terverifikasi.</b>\n` +
      `📉 Trust score: <b>−5</b> → <b>${newScore}</b>`;
    if (banned && banUntil) {
      return `${head}\n🚫 <b>Auto-ban 24 jam</b> (5 report dalam 24 jam).\nBerakhir: <b>${banUntil}</b>`;
    }
    return `${head}\n<i>Akumulasi 5 report dalam 24 jam akan memicu ban otomatis 24 jam.</i>`;
  },
  historyLine: (h: TrustEventRow) => {
    const sign = h.delta > 0 ? "+" : "";
    const emoji = h.delta > 0 ? "📈" : h.delta < 0 ? "📉" : "➖";
    const t = new Date(h.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
    const dur = h.duration_sec != null
      ? ` · ${Math.floor(h.duration_sec / 60)}m${h.duration_sec % 60}s`
      : "";
    return `${emoji} <b>${sign}${h.delta}</b> → ${h.new_score} · <i>${h.event_type}</i>${dur}\n   <code>${t}</code> — ${h.reason}`;
  },
  invalidAlias: `❌ Alias harus 3–20 karakter.`,
  invalidProvince: `❌ Provinsi tidak ditemukan. Coba lagi (mis. "Jawa Barat"):`,
  premiumOnlyGenderFilter: `⭐ Filter gender hanya untuk Premium. Preferensi diset ke "any".`,
  detectionWarning: (reason: string, banned: boolean, newScore: number) => {
    const badge = trustLabel(newScore);
    return banned
      ? `🚫 <b>Akun di-ban 24 jam.</b>\nAlasan: <i>${reason}</i>\n📉 Trust: <b>${newScore}</b> — ${badge}\nKetik /premium untuk info banding.`
      : `⚠️ <b>Pesan kamu ditandai sistem.</b>\nAlasan: <i>${reason}</i>\n📉 Trust −10 → <b>${newScore}</b> — ${badge}\nHindari spam, link, scam, atau pelecehan.`;
  },
  partnerSanctioned: (banned: boolean) =>
    banned
      ? `🚫 Lawan bicara di-ban karena melanggar aturan. Sesi diakhiri otomatis.`
      : `⚠️ Lawan bicara ditandai sistem. Tetap waspada.`,
  contentBlocked: `❌ Pesan tidak terkirim — mengandung konten yang tidak diizinkan.`,
  nonaiEnabled:
    `🚫 <b>AI Companion dinonaktifkan.</b>\n` +
    `Kamu hanya akan di-match dengan manusia nyata.\n` +
    `<i>⚠️ Jika tidak ada user aktif, kamu akan menunggu lebih lama tanpa fallback AI.</i>\n\n` +
    `Ketik /nonai lagi untuk mengaktifkan AI kembali.`,
  nonaiDisabled:
    `✅ <b>AI Companion diaktifkan kembali.</b>\n` +
    `Jika tidak ada match dalam 60 detik, AI Companion akan menyapa kamu.`,
};

export type TrustEventRow = {
  delta: number;
  new_score: number;
  event_type: string;
  reason: string;
  duration_sec: number | null;
  created_at: string;
};

async function ensureProfile(supabase: ReturnType<typeof getSupabase>, msg: TgMessage): Promise<Profile> {
  const tgUser = msg.from!;
  const alias = tgUser.first_name?.slice(0, 20) || tgUser.username?.slice(0, 20) || `Anon${tgUser.id % 10000}`;
  const { data, error } = await supabase.rpc("find_or_create_profile_by_telegram_id", {
    _telegram_user_id: tgUser.id,
    _telegram_chat_id: msg.chat.id,
    _telegram_username: tgUser.username ?? null,
    _alias: alias,
    _language_code: tgUser.language_code ?? "id",
  });
  if (error) throw error;
  const profileId = data as string;
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();
  if (pErr) throw pErr;
  return profile as Profile;
}

async function getActiveConversation(supabase: ReturnType<typeof getSupabase>, profileId: string) {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .or(`user_a.eq.${profileId},user_b.eq.${profileId}`)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getProfileById(supabase: ReturnType<typeof getSupabase>, id: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Profile;
}

async function getInterests(supabase: ReturnType<typeof getSupabase>, profileId: string): Promise<string[]> {
  const { data } = await supabase.from("user_interests").select("tag").eq("profile_id", profileId);
  return (data ?? []).map((r: { tag: string }) => r.tag);
}

export type TrustEventType = "stop" | "block" | "report" | "reported" | "match_bonus" | "ban" | "manual";

export async function recordTrustEvent(
  supabase: ReturnType<typeof getSupabase>,
  profileId: string,
  delta: number,
  eventType: TrustEventType,
  reason: string,
  conversationId: string | null = null,
  durationSec: number | null = null,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("record_trust_event", {
    _profile_id: profileId,
    _delta: delta,
    _event_type: eventType,
    _reason: reason,
    _conversation_id: conversationId,
    _duration_sec: durationSec,
  });
  if (error) {
    console.error("record_trust_event failed", error);
    return null;
  }
  return data as number;
}

export function trustLabel(score: number): string {
  if (score >= 120) return "🌟 Sangat Terpercaya";
  if (score >= 90) return "✅ Terpercaya";
  if (score >= 60) return "🙂 Normal";
  if (score >= 30) return "⚠️ Rendah";
  return "🚨 Sangat Rendah";
}

export type TrustFilter = "any" | "normal" | "trusted" | "very_trusted";

export function parseTrustFilter(text: string | null | undefined): TrustFilter {
  if (!text) return "any";
  const t = text.trim().toLowerCase();
  if (["normal", "biasa"].includes(t)) return "normal";
  if (["trusted", "terpercaya", "tepercaya"].includes(t)) return "trusted";
  if (["very_trusted", "sangat_terpercaya", "sangat-terpercaya", "elite", "vt"].includes(t)) return "very_trusted";
  return "any";
}

export function trustFilterMin(filter: TrustFilter): number {
  switch (filter) {
    case "normal": return 60;
    case "trusted": return 90;
    case "very_trusted": return 120;
    default: return 0;
  }
}

export function trustFilterLabel(filter: TrustFilter): string {
  switch (filter) {
    case "normal": return "🙂 Normal+ (≥60)";
    case "trusted": return "✅ Terpercaya+ (≥90)";
    case "very_trusted": return "🌟 Sangat Terpercaya+ (≥120)";
    default: return "Semua";
  }
}

// ---------- Pure matching algorithm (exported untuk testing) ----------

export type QueueEntry = {
  profile_id: string;
  province_code: string | null;
  gender: "male" | "female" | "other" | null;
  gender_preference: "male" | "female" | "any";
  is_premium: boolean;
  joined_at: string;
};

export type MatchInputs = {
  requester: {
    id: string;
    province_code: string | null;
    gender: "male" | "female" | "other" | null;
    gender_preference: "male" | "female" | "any";
    is_premium: boolean;
    trust_score: number;
    joined_at: string;
    interests: Set<string>;
  };
  candidates: QueueEntry[];
  trustById: Map<string, number>;
  interestsById: Map<string, string[]>;
  blockedSet: Set<string>;
  trustFilter: TrustFilter;
  nowMs: number;
};

export type Scored = { entry: QueueEntry; score: number; theirTrust: number };

const TRUST_BONUS = (t: number) =>
  Math.max(-5, Math.min(5, Math.floor((t - 70) / 20)));

function effectiveTrustMin(filter: TrustFilter, waitSec: number): number {
  const base = trustFilterMin(filter);
  if (base === 0) return 0;
  const relaxedSteps = Math.floor(Math.max(0, waitSec - 90) / 60);
  return Math.max(0, base - relaxedSteps * 30);
}

export function scoreCandidates(input: MatchInputs): Scored | null {
  const { requester, candidates, trustById, interestsById, blockedSet, trustFilter, nowMs } = input;
  const myPref = requester.is_premium ? requester.gender_preference : "any";
  const myTrustBonus = TRUST_BONUS(requester.trust_score);
  const myWaitSec = (nowMs - new Date(requester.joined_at).getTime()) / 1000;
  const myWaitBoost = Math.floor(myWaitSec / 30);
  const trustMin = effectiveTrustMin(trustFilter, myWaitSec);

  const scored: Scored[] = [];
  for (const c of candidates) {
    if (blockedSet.has(c.profile_id)) continue;
    if (myPref !== "any" && c.gender && c.gender !== myPref) continue;
    if (c.is_premium && c.gender_preference !== "any" && requester.gender && c.gender_preference !== requester.gender) continue;

    const theirTrust = trustById.get(c.profile_id) ?? 100;
    if (theirTrust < trustMin) continue;

    let score = 0;
    if (requester.province_code && c.province_code === requester.province_code) score += 3;
    if (myPref !== "any" && c.gender === myPref) score += 2;
    const theirInterests = interestsById.get(c.profile_id) ?? [];
    const overlap = theirInterests.filter((t) => requester.interests.has(t)).length;
    score += overlap;

    score += Math.floor((TRUST_BONUS(theirTrust) + myTrustBonus) / 2);

    const candWaitSec = (nowMs - new Date(c.joined_at).getTime()) / 1000;
    score += Math.floor(candWaitSec / 30);

    scored.push({ entry: c, score, theirTrust });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) =>
    b.score - a.score ||
    new Date(a.entry.joined_at).getTime() - new Date(b.entry.joined_at).getTime()
  );
  const best = scored[0];

  const baseThreshold = requester.trust_score >= 70 ? 0 : Math.ceil((70 - requester.trust_score) / 15);
  const effectiveThreshold = Math.max(0, baseThreshold - myWaitBoost);
  if (best.score < effectiveThreshold) return null;
  return best;
}

// ---------- DB-backed wrapper ----------

async function tryMatch(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  trustFilter: TrustFilter = "any",
) {
  const now = Date.now();

  const { data: existingQ } = await supabase
    .from("match_queue")
    .select("joined_at")
    .eq("profile_id", profile.id)
    .maybeSingle();
  const myJoinedAt = existingQ?.joined_at ?? new Date().toISOString();

  await supabase.from("match_queue").upsert(
    {
      profile_id: profile.id,
      province_code: profile.province_code,
      gender: profile.gender,
      gender_preference: profile.is_premium ? profile.gender_preference : "any",
      is_premium: profile.is_premium,
      status: "waiting",
      joined_at: myJoinedAt,
    },
    { onConflict: "profile_id" },
  );

  const aiId = await ensureAiProfile(supabase);

  const { data: candidates } = await supabase
    .from("match_queue")
    .select("profile_id, province_code, gender, gender_preference, is_premium, joined_at")
    .eq("status", "waiting")
    .neq("profile_id", profile.id)
    .neq("profile_id", aiId)
    .order("joined_at", { ascending: true })
    .limit(50);

  if (!candidates || candidates.length === 0) return null;

  const { data: blocks } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`);
  const blockedSet = new Set<string>();
  for (const b of blocks ?? []) {
    blockedSet.add(b.blocker_id === profile.id ? b.blocked_id : b.blocker_id);
  }

  const myInterests = new Set(await getInterests(supabase, profile.id));

  const candidateIds = candidates.map((c) => c.profile_id);
  const { data: candidateProfiles } = await supabase
    .from("profiles")
    .select("id, trust_score")
    .in("id", candidateIds);
  const trustById = new Map<string, number>(
    (candidateProfiles ?? []).map((p: { id: string; trust_score: number }) => [p.id, p.trust_score]),
  );

  const { data: interestRows } = await supabase
    .from("user_interests")
    .select("profile_id, tag")
    .in("profile_id", candidateIds);
  const interestsById = new Map<string, string[]>();
  for (const row of interestRows ?? []) {
    const arr = interestsById.get(row.profile_id) ?? [];
    arr.push(row.tag);
    interestsById.set(row.profile_id, arr);
  }

  const best = scoreCandidates({
    requester: {
      id: profile.id,
      province_code: profile.province_code,
      gender: profile.gender,
      gender_preference: profile.gender_preference,
      is_premium: profile.is_premium,
      trust_score: profile.trust_score,
      joined_at: myJoinedAt,
      interests: myInterests,
    },
    candidates: candidates as QueueEntry[],
    trustById,
    interestsById,
    blockedSet,
    trustFilter,
    nowMs: now,
  });

  if (!best) return null;

  const partner = await getProfileById(supabase, best.entry.profile_id);
  const sameProvince = !!profile.province_code && profile.province_code === partner.province_code;

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .insert({
      user_a: profile.id,
      user_b: partner.id,
      same_province: sameProvince,
      match_score: best.score,
      status: "active",
    })
    .select()
    .single();
  if (convErr) return null;

  await supabase.from("match_queue").delete().in("profile_id", [profile.id, partner.id]);

  return { conversation: conv, partner, sameProvince };
}

async function handleStart(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  await sendMessage(profile.telegram_chat_id, T.welcome(profile.alias));
  // Send full command list so user knows all available commands
  await sendMessage(profile.telegram_chat_id, T.startCommandList);
  if (!profile.onboarding_completed) {
    await persistStep(supabase, profile.telegram_chat_id, { name: "set_alias" });
    await sendMessage(profile.telegram_chat_id, T.promptAlias);
  }
}

async function handleProfileStart(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  await persistStep(supabase, profile.telegram_chat_id, { name: "set_alias" });
  await sendMessage(profile.telegram_chat_id, T.promptAlias);
}

async function fetchTrustHistory(
  supabase: ReturnType<typeof getSupabase>,
  profileId: string,
  limit = 5,
): Promise<TrustEventRow[]> {
  const { data, error } = await supabase
    .from("trust_events")
    .select("delta, new_score, event_type, reason, duration_sec, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("fetchTrustHistory failed", error);
    return [];
  }
  return (data ?? []) as TrustEventRow[];
}

async function handleMe(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const [interests, history] = await Promise.all([
    getInterests(supabase, profile.id),
    fetchTrustHistory(supabase, profile.id, 5),
  ]);
  await safeSend(profile.telegram_chat_id, T.profileDone(profile, interests, history));
}

async function handleHelp(profile: Profile) {
  await sendMessage(profile.telegram_chat_id, T.help);
}

async function handleUnban(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  arg: string | null,
) {
  if (!profile.is_banned_until || new Date(profile.is_banned_until) <= new Date()) {
    await sendMessage(profile.telegram_chat_id, "✅ Akun kamu tidak sedang di-ban. Ketik /cari untuk mulai.");
    return;
  }
  const sev = (arg ?? "").toLowerCase();
  if (!["light", "medium", "severe"].includes(sev)) {
    await sendInlineKeyboard(
      profile.telegram_chat_id,
      `🚫 <b>Unban Berbayar</b>\n\nPilih tingkat ban kamu:\n` +
      `• Ringan — Rp5.000 (&lt;7 report)\n` +
      `• Sedang — Rp10.000 (7–9 report)\n` +
      `• Berat — Rp15.000 (≥10 report)\n\n` +
      `Premium aktif dapat 1× unban gratis (light) per bulan via /upgrade.`,
      [[
        { text: "Ringan Rp5rb", callback_data: "unban:light" },
        { text: "Sedang Rp10rb", callback_data: "unban:medium" },
        { text: "Berat Rp15rb", callback_data: "unban:severe" },
      ]],
    );
    return;
  }
  // Premium monthly free unban credit (light only)
  if (profile.is_premium && !((profile as any).monthly_unban_credit_used) && sev === "light") {
    await supabase.from("profiles").update({
      is_banned_until: null, ban_reason: null, ban_severity: null,
      monthly_unban_credit_used: true,
    }).eq("id", profile.id);
    await sendMessage(profile.telegram_chat_id, "🎁 Premium bonus: unban gratis bulan ini dipakai. Akun aktif kembali.");
    return;
  }
  const { data, error } = await supabase.rpc("request_unban", { _profile_id: profile.id, _severity: sev });
  if (error || !data?.ok) {
    await sendMessage(profile.telegram_chat_id, "❌ Gagal membuat permintaan unban. Coba lagi.");
    return;
  }
  const refCode = data.reference_code as string;
  const amount = data.amount_idr as number;
  await persistStep(supabase, profile.telegram_chat_id, { name: "await_payment_proof", referenceCode: refCode } as any);
  await sendPhoto(
    profile.telegram_chat_id,
    QRIS_IMAGE_URL,
    `📷 Scan QRIS — kode: <b>${refCode}</b>\n💰 Nominal: <b>Rp${amount.toLocaleString("id-ID")}</b>`,
  ).catch(() => {});
  await safeSend(
    profile.telegram_chat_id,
    `Setelah transfer, kirim foto bukti transfer (caption opsional). AI akan memverifikasi nominal otomatis.\n` +
    `Kode referensi: <code>${refCode}</code>\n\n` +
    `<i>Salah kirim foto? Ketik /batal untuk batalkan.</i>`,
  );
}

async function handlePremium(profile: Profile) {
  await sendMessage(profile.telegram_chat_id, T.premium(profile.is_premium, profile.premium_until ?? null));
}

async function handleUpgrade(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  // Check pending request
  const { data: pending } = await supabase
    .from("payment_requests")
    .select("reference_code, proof_note")
    .eq("profile_id", profile.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let refCode: string;
  if (pending) {
    refCode = pending.reference_code;
    const hasProof = !!(pending.proof_note && pending.proof_note.trim().length > 0);
    // Show existing pending status
    await safeSend(profile.telegram_chat_id, T.upgradeAlreadyPending(refCode, hasProof));
    if (!hasProof) {
      // Keep step so user can still send proof
      await persistStep(supabase, profile.telegram_chat_id, { name: "await_payment_proof", referenceCode: refCode });
      // Re-send QRIS image + instructions
      await sendPhoto(
        profile.telegram_chat_id,
        QRIS_IMAGE_URL,
        `📷 QRIS untuk pembayaran kode <b>${refCode}</b>`,
      ).catch((e) => console.error("sendPhoto QRIS failed", e));
      await safeSend(profile.telegram_chat_id, T.upgradeInstructions(refCode));
    }
    return;
  } else {
    const { data, error } = await supabase.rpc("request_premium_upgrade", {
      _profile_id: profile.id,
      _plan: "monthly",
      _amount_idr: PREMIUM_MONTHLY_IDR,
    });
    if (error) {
      console.error("request_premium_upgrade failed", error);
      await safeSend(profile.telegram_chat_id, "❌ Gagal membuat permintaan upgrade. Coba lagi nanti.");
      return;
    }
    refCode = String(data);
  }
  await persistStep(supabase, profile.telegram_chat_id, { name: "await_payment_proof", referenceCode: refCode });
  // Send QRIS photo first, then instructions
  await sendPhoto(
    profile.telegram_chat_id,
    QRIS_IMAGE_URL,
    `📷 Scan QR ini untuk bayar Premium — kode: <b>${refCode}</b>`,
  ).catch((e) => console.error("sendPhoto QRIS failed", e));
  await safeSend(profile.telegram_chat_id, T.upgradeInstructions(refCode));
}

// ============= /batal — cancel pending payment proof upload =============
async function handleCancelProof(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const currentStep = stepByChat.get(profile.telegram_chat_id);
  const refFromStep = currentStep?.name === "await_payment_proof" ? currentStep.referenceCode : null;
  const refCode = refFromStep ?? profile.pending_payment_ref ?? null;

  if (!refCode) {
    await sendMessage(
      profile.telegram_chat_id,
      "ℹ️ Tidak ada upload bukti transfer yang sedang berlangsung.",
    );
    return;
  }

  // Cancel pending payment_request (only if still pending and no proof yet)
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("id, status, proof_image_file_id, proof_note")
    .eq("reference_code", refCode)
    .maybeSingle();

  if (pr && pr.status === "pending") {
    await supabase
      .from("payment_requests")
      .update({
        status: "cancelled",
        admin_note: "Dibatalkan oleh user via /batal",
        updated_at: new Date().toISOString(),
      })
      .eq("id", pr.id);
  }

  await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
  await sendMessage(
    profile.telegram_chat_id,
    `❎ <b>Upload bukti transfer dibatalkan.</b>\n\n` +
    `Kode <code>${refCode}</code> dibatalkan. Kalau mau coba lagi:\n` +
    `• Premium → /upgrade\n` +
    `• Unban → /unban [light|medium|severe]`,
  );
}

// ============= Photo proof upload handler (AI Vision validation) =============
async function handlePhotoProof(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  msg: TgMessage,
): Promise<boolean> {
  const step = await loadStep(supabase, profile.telegram_chat_id, profile);
  if (step.name !== "await_payment_proof") {
    await sendMessage(
      profile.telegram_chat_id,
      "ℹ️ Foto diterima, tapi tidak ada pembayaran yang menunggu bukti.\nKetik /upgrade untuk premium atau /unban untuk buka ban.",
    );
    return true;
  }

  const photos = msg.photo ?? [];
  if (photos.length === 0) return false;
  // Pick highest-resolution photo
  const best = photos.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));

  await safeSend(profile.telegram_chat_id, "🔍 Memverifikasi bukti transfer dengan AI… (5–15 detik)");

  const fileData = await downloadTelegramFile(best.file_id);
  if (!fileData) {
    await safeSend(
      profile.telegram_chat_id,
      "❌ Gagal mengunduh foto dari Telegram. Coba kirim ulang, atau ketik /batal untuk batalkan.",
    );
    return true;
  }

  // Save file_id to payment_request for admin reference
  await supabase
    .from("payment_requests")
    .update({
      proof_image_file_id: best.file_id,
      proof_note: msg.caption?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("reference_code", step.referenceCode);

  // Call AI Vision validator edge function
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let validation: {
    ok?: boolean;
    expected_idr?: number;
    extracted_idr?: number;
    shortfall_idr?: number;
    matched?: boolean;
    auto_approve_eligible?: boolean;
    note?: string;
    error?: string;
  } = {};
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-payment-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        reference_code: step.referenceCode,
        image_base64: fileData.base64,
        image_mime: fileData.mime,
      }),
    });
    validation = await res.json();
  } catch (err) {
    console.error("validate-payment-proof failed", err);
    await safeSend(
      profile.telegram_chat_id,
      "⚠️ AI verifikasi sedang sibuk. Bukti tetap tersimpan & akan diperiksa admin manual (1×24 jam).\nKetik /batal kalau salah kirim foto.",
    );
    await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
    return true;
  }

  if (validation.error || !validation.ok) {
    await safeSend(
      profile.telegram_chat_id,
      "⚠️ Bukti tersimpan, tapi AI tidak dapat memverifikasi otomatis. Admin akan cek manual (1×24 jam).\nKalau salah kirim foto, ketik /batal.",
    );
    return true;
  }

  const expected = validation.expected_idr ?? 0;
  const extracted = validation.extracted_idr ?? 0;
  const shortfall = validation.shortfall_idr ?? 0;

  if (shortfall > 0) {
    // Underpaid — keep step active so user can send another receipt
    await safeSend(
      profile.telegram_chat_id,
      `⚠️ <b>Nominal kurang.</b>\n\n` +
      `• Diharapkan: <b>Rp${expected.toLocaleString("id-ID")}</b>\n` +
      `• Terbaca AI: <b>Rp${extracted.toLocaleString("id-ID")}</b>\n` +
      `• Kurang: <b>Rp${shortfall.toLocaleString("id-ID")}</b>\n\n` +
      `Silakan transfer kekurangannya lalu kirim ulang foto bukti transfer baru.\n` +
      `Atau ketik /batal untuk membatalkan.`,
    );
    return true;
  }

  if (validation.auto_approve_eligible) {
    // Auto-approve via RPC
    const { data: pr } = await supabase
      .from("payment_requests")
      .select("id, payment_kind")
      .eq("reference_code", step.referenceCode)
      .maybeSingle();
    if (pr) {
      const args = pr.payment_kind === "unban"
        ? { _reference_code: step.referenceCode, _admin_id: null, _admin_note: "Auto-approved by AI Vision" }
        : { _reference_code: step.referenceCode, _days: 30, _admin_id: null, _admin_note: "Auto-approved by AI Vision" };
      const rpc = pr.payment_kind === "unban" ? "approve_unban_payment" : "approve_premium_payment";
      try { await supabase.rpc(rpc, args); } catch (e) { console.error(`${rpc} failed`, e); }
    }
    await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
    await safeSend(
      profile.telegram_chat_id,
      `✅ <b>Pembayaran terverifikasi otomatis oleh AI!</b>\n\n` +
      `• Nominal: <b>Rp${extracted.toLocaleString("id-ID")}</b>\n` +
      `• Status: aktif. Selamat menikmati!`,
    );
    return true;
  }

  // Matched but low confidence → wait for admin
  await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
  await safeSend(
    profile.telegram_chat_id,
    `✅ <b>Bukti diterima & nominal cocok</b> (Rp${extracted.toLocaleString("id-ID")}).\n` +
    `Verifikasi akhir oleh admin (≤1×24 jam). Kamu akan dapat notifikasi otomatis.`,
  );
  return true;
}

async function handleCari(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  trustFilter: TrustFilter = "any",
) {
  if (profile.is_banned_until && new Date(profile.is_banned_until) > new Date()) {
    await sendMessage(profile.telegram_chat_id, T.bannedUntil(new Date(profile.is_banned_until).toLocaleString("id-ID")));
    return;
  }
  if (!profile.onboarding_completed) {
    await sendMessage(profile.telegram_chat_id, T.needOnboarding);
    return;
  }
  const active = await getActiveConversation(supabase, profile.id);
  if (active) {
    await sendMessage(profile.telegram_chat_id, T.alreadyChatting);
    return;
  }
  await sendMessage(profile.telegram_chat_id, T.searching(true, profile.province_name, trustFilter, profile.no_ai));

  const result = await tryMatch(supabase, profile, trustFilter);
  if (!result) {
    await sendMessage(profile.telegram_chat_id, profile.no_ai ? T.inQueueNoAi : T.inQueue);
    return;
  }

  const { partner, sameProvince } = result;
  await safeSend(profile.telegram_chat_id, T.matchFound(partner.alias, partner.province_name ?? "-", sameProvince));
  await safeSend(partner.telegram_chat_id, T.matchFound(profile.alias, profile.province_name ?? "-", sameProvince));
}


async function endConversation(
  supabase: ReturnType<typeof getSupabase>,
  conv: { id: string; user_a: string; user_b: string; started_at: string },
  enderId: string,
): Promise<{ durationSec: number }> {
  const endedAt = new Date();
  await supabase
    .from("conversations")
    .update({ status: "ended", ended_at: endedAt.toISOString(), ended_by: enderId })
    .eq("id", conv.id);
  msgCountByConv.delete(conv.id);
  const durationSec = (endedAt.getTime() - new Date(conv.started_at).getTime()) / 1000;
  return { durationSec };
}

function trustDeltasFromDuration(durationSec: number): { ender: number; partner: number } {
  if (durationSec < 30) return { ender: -3, partner: 0 };
  if (durationSec >= 300) return { ender: 3, partner: 3 };
  return { ender: 0, partner: 0 };
}

function trustReason(durationSec: number): string {
  const mm = Math.floor(durationSec / 60);
  const ss = Math.floor(durationSec % 60);
  const dur = `${mm}m ${ss}s`;
  if (durationSec < 30) return `Sesi diakhiri terlalu cepat (${dur} &lt; 30 detik). Pemutus −3.`;
  if (durationSec >= 300) return `Sesi sehat (${dur} ≥ 5 menit, tanpa report). Kedua pihak +3.`;
  return `Sesi netral (${dur}). Skor tidak berubah.`;
}

async function applyEndTrust(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  partner: Profile,
  conversationId: string,
  durationSec: number,
) {
  // Skip trust effects when partner is AI (AI Companion has no trust dynamics)
  if (partner.telegram_user_id === AI_TELEGRAM_USER_ID) return;
  const { ender, partner: partnerDelta } = trustDeltasFromDuration(durationSec);
  const reason = trustReason(durationSec);
  const durInt = Math.round(durationSec);

  const enderNew = ender !== 0
    ? await recordTrustEvent(supabase, profile.id, ender, "stop", reason, conversationId, durInt)
    : profile.trust_score;
  const partnerNew = partnerDelta !== 0
    ? await recordTrustEvent(supabase, partner.id, partnerDelta, "stop", reason, conversationId, durInt)
    : partner.trust_score;

  if (enderNew !== null) {
    await safeSend(profile.telegram_chat_id, T.trustSummary(ender, enderNew, reason));
  }
  if (partnerNew !== null && partner.telegram_user_id !== AI_TELEGRAM_USER_ID) {
    await safeSend(partner.telegram_chat_id, T.trustSummary(partnerDelta, partnerNew, reason));
  }
}

async function handleStop(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const { data: q } = await supabase.from("match_queue").select("*").eq("profile_id", profile.id).maybeSingle();
  if (q) {
    await supabase.from("match_queue").delete().eq("profile_id", profile.id);
    await sendMessage(profile.telegram_chat_id, T.cancelled);
    return;
  }
  const conv = await getActiveConversation(supabase, profile.id);
  if (!conv) {
    await sendMessage(profile.telegram_chat_id, T.notInChat);
    return;
  }
  const { durationSec } = await endConversation(supabase, conv, profile.id);
  const partnerId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  const partner = await getProfileById(supabase, partnerId);
  await safeSend(profile.telegram_chat_id, T.youLeft);
  if (partner.telegram_user_id !== AI_TELEGRAM_USER_ID) {
    await safeSend(partner.telegram_chat_id, T.partnerLeft);
  }
  await applyEndTrust(supabase, profile, partner, conv.id, durationSec);
}

async function handleReport(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const conv = await getActiveConversation(supabase, profile.id);
  if (!conv) {
    await sendMessage(profile.telegram_chat_id, T.reportNoChat);
    return;
  }
  const reportedId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  const reported = await getProfileById(supabase, reportedId);
  if (reported.telegram_user_id === AI_TELEGRAM_USER_ID) {
    await sendMessage(profile.telegram_chat_id, "ℹ️ Kamu sedang dengan AI Companion. Untuk feedback AI, ketik /stop saja.");
    return;
  }
  await persistStep(supabase, profile.telegram_chat_id, {
    name: "await_report_reason",
    conversationId: conv.id,
    reportedId,
  });
  await sendInlineKeyboard(profile.telegram_chat_id, T.reportPrompt, [
    [
      { text: "Spam", callback_data: "report:spam" },
      { text: "Asusila", callback_data: "report:nsfw" },
      { text: "Bot", callback_data: "report:bot" },
    ],
    [
      { text: "Scam", callback_data: "report:scam" },
      { text: "Pelecehan", callback_data: "report:harassment" },
      { text: "Lainnya", callback_data: "report:other" },
    ],
    [{ text: "❎ Batal", callback_data: "report:cancel" }],
  ]);
}

async function handleBlock(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const conv = await getActiveConversation(supabase, profile.id);
  if (!conv) {
    await sendMessage(profile.telegram_chat_id, T.blockNoChat);
    return;
  }
  const blockedId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  const partner = await getProfileById(supabase, blockedId);

  if (partner.telegram_user_id === AI_TELEGRAM_USER_ID) {
    await sendMessage(profile.telegram_chat_id, "ℹ️ Tidak bisa block AI Companion. Ketik /stop saja.");
    return;
  }

  const { error } = await supabase.from("user_blocks").insert({
    blocker_id: profile.id,
    blocked_id: blockedId,
  });
  if (error?.message.includes("duplicate")) {
    await safeSend(profile.telegram_chat_id, T.blockAlready);
  } else if (error) {
    console.error("block insert failed", error);
  }

  const durationSec = Math.round((Date.now() - new Date(conv.started_at).getTime()) / 1000);
  await endConversation(supabase, conv, profile.id);

  try { await removeKeyboard(profile.telegram_chat_id, T.blockSuccess(partner.alias)); }
  catch (e) { console.error("removeKeyboard failed", e); await safeSend(profile.telegram_chat_id, T.blockSuccess(partner.alias)); }
  await safeSend(partner.telegram_chat_id, T.blockNotice);

  const blockedDelta = -3;
  const blockerDelta = 0;
  const reason = `Sesi diakhiri via /block (${Math.floor(durationSec / 60)}m${durationSec % 60}s). Yang di-block −3.`;

  const blockerNew = blockerDelta !== 0
    ? await recordTrustEvent(supabase, profile.id, blockerDelta, "block", reason, conv.id, durationSec)
    : profile.trust_score;
  const blockedNew = await recordTrustEvent(supabase, partner.id, blockedDelta, "block", reason, conv.id, durationSec);

  if (blockerNew !== null) await safeSend(profile.telegram_chat_id, T.trustSummary(blockerDelta, blockerNew, reason));
  if (blockedNew !== null) await safeSend(partner.telegram_chat_id, T.trustSummary(blockedDelta, blockedNew, reason));
}

// ============= ADMIN COMMANDS =============
async function isAdmin(supabase: ReturnType<typeof getSupabase>, profileId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _profile_id: profileId, _role: "admin" });
  return !!data;
}

async function handleAdmin(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  args: string[],
) {
  if (!(await isAdmin(supabase, profile.id))) {
    await sendMessage(profile.telegram_chat_id, "🚫 Akses admin saja.");
    return;
  }
  const sub = args[0]?.toLowerCase();
  if (!sub) {
    await sendMessage(
      profile.telegram_chat_id,
      `<b>Admin commands</b>\n` +
        `/admin pending — list payment pending\n` +
        `/admin approve &lt;ref&gt; [days] — approve payment\n` +
        `/admin reject &lt;ref&gt; [note] — reject payment\n` +
        `/admin stats — statistik global\n` +
        `/admin unban &lt;telegram_user_id&gt; — unban user\n` +
        `/admin bot-signals [tg_id] — bot/spam/scam signals per user\n` +
        `/admin unban-signal &lt;signal_id&gt; — batalkan false-positive ban`,
    );
    return;
  }
  if (sub === "pending") {
    const { data } = await supabase
      .from("payment_requests")
      .select("reference_code, profile_id, plan, amount_idr, created_at, proof_note")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!data || data.length === 0) {
      await sendMessage(profile.telegram_chat_id, "✅ Tidak ada pending payment.");
      return;
    }
    const lines = data.map((r) =>
      `<code>${r.reference_code}</code> · ${r.plan} · Rp${Number(r.amount_idr).toLocaleString("id-ID")}\n` +
      `   <i>${new Date(r.created_at).toLocaleString("id-ID")}</i>\n` +
      `   proof: ${r.proof_note ? r.proof_note.slice(0, 100) : "-"}`
    );
    await sendMessage(profile.telegram_chat_id, `<b>Pending (${data.length})</b>\n\n${lines.join("\n\n")}`);
    return;
  }
  if (sub === "approve") {
    const ref = args[1];
    const days = parseInt(args[2] ?? "30", 10) || 30;
    if (!ref) { await sendMessage(profile.telegram_chat_id, "Usage: /admin approve &lt;ref&gt; [days]"); return; }
    const { data, error } = await supabase.rpc("approve_premium_payment", {
      _reference_code: ref, _days: days, _admin_id: profile.id, _admin_note: null,
    });
    if (error || !data) { await sendMessage(profile.telegram_chat_id, `❌ Gagal: ${error?.message ?? "not found/already processed"}`); return; }
    // notify user
    const { data: pr } = await supabase.from("payment_requests").select("profile_id").eq("reference_code", ref).maybeSingle();
    if (pr) {
      const { data: u } = await supabase.from("profiles").select("telegram_chat_id, premium_until").eq("id", pr.profile_id).single();
      if (u) await safeSend(u.telegram_chat_id, `⭐ Premium aktif sampai <b>${new Date(u.premium_until).toLocaleString("id-ID")}</b>. Selamat!`);
    }
    await sendMessage(profile.telegram_chat_id, `✅ Approved ${ref} (+${days}d)`);
    return;
  }
  if (sub === "reject") {
    const ref = args[1];
    const note = args.slice(2).join(" ") || null;
    if (!ref) { await sendMessage(profile.telegram_chat_id, "Usage: /admin reject &lt;ref&gt; [note]"); return; }
    const { data, error } = await supabase.rpc("reject_premium_payment", {
      _reference_code: ref, _admin_id: profile.id, _admin_note: note,
    });
    if (error || !data) { await sendMessage(profile.telegram_chat_id, `❌ Gagal: ${error?.message ?? "not found/already processed"}`); return; }
    const { data: pr } = await supabase.from("payment_requests").select("profile_id").eq("reference_code", ref).maybeSingle();
    if (pr) {
      const { data: u } = await supabase.from("profiles").select("telegram_chat_id").eq("id", pr.profile_id).single();
      if (u) await safeSend(u.telegram_chat_id, `❌ Pembayaran <code>${ref}</code> ditolak.${note ? `\nCatatan: <i>${note}</i>` : ""}\nHubungi admin jika ada kekeliruan.`);
    }
    await sendMessage(profile.telegram_chat_id, `✅ Rejected ${ref}`);
    return;
  }
  if (sub === "stats") {
    const [{ count: nProfiles }, { count: nActive }, { count: nReports }, { count: nBots }] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("user_reports").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
      supabase.from("bot_signals").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    await sendMessage(profile.telegram_chat_id,
      `<b>📊 Stats</b>\n` +
      `Profiles: <b>${nProfiles ?? 0}</b>\n` +
      `Active chats: <b>${nActive ?? 0}</b>\n` +
      `Reports 24h: <b>${nReports ?? 0}</b>\n` +
      `Bot signals 24h: <b>${nBots ?? 0}</b>`);
    return;
  }
  if (sub === "unban") {
    const tgId = parseInt(args[1] ?? "", 10);
    if (!tgId) { await sendMessage(profile.telegram_chat_id, "Usage: /admin unban &lt;telegram_user_id&gt;"); return; }
    const { data: target } = await supabase.from("profiles").select("id, telegram_chat_id").eq("telegram_user_id", tgId).maybeSingle();
    if (!target) { await sendMessage(profile.telegram_chat_id, "❌ User tidak ditemukan."); return; }
    await supabase.from("profiles").update({ is_banned_until: null, ban_reason: null }).eq("id", target.id);
    await safeSend(target.telegram_chat_id, "✅ Akun kamu di-unban oleh admin.");
    await sendMessage(profile.telegram_chat_id, `✅ Unbanned tg=${tgId}`);
    return;
  }
  if (sub === "bot-signals") {
    const tgId = args[1] ? parseInt(args[1], 10) : null;
    let query = supabase
      .from("bot_signals")
      .select("id, profile_id, signal_type, score, details, created_at, profiles!inner(alias, telegram_user_id, trust_score, is_banned_until)")
      .order("created_at", { ascending: false })
      .limit(15);
    if (tgId) {
      const { data: tgProfile } = await supabase.from("profiles").select("id").eq("telegram_user_id", tgId).maybeSingle();
      if (!tgProfile) { await sendMessage(profile.telegram_chat_id, "❌ User tidak ditemukan."); return; }
      query = query.eq("profile_id", tgProfile.id);
    }
    const { data: signals } = await query;
    if (!signals || signals.length === 0) {
      await sendMessage(profile.telegram_chat_id, "✅ Tidak ada bot signals.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = signals.map((s: any) => {
      const p = s.profiles;
      const scoreVal = Number(s.score).toFixed(2);
      const scoreEmoji = s.score >= 0.85 ? "🔴" : s.score >= 0.5 ? "🟡" : "🟢";
      const det = s.details ?? {};
      const aiReason = det.ai?.reason ?? "";
      const behReasons = (det.behavioral?.reasons ?? []).join(", ");
      const reason = aiReason || behReasons || "-";
      const isBanned = p.is_banned_until && new Date(p.is_banned_until) > new Date();
      const impact = isBanned ? `trust −10, banned` : `trust −10`;
      const cancelled = det.cancelled ? " [DIBATALKAN]" : "";
      const t = new Date(s.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
      return `${scoreEmoji} Score: <b>${scoreVal}</b> · ${s.signal_type}${cancelled}\n` +
        `👤 ${p.alias} (tg=${p.telegram_user_id}) · trust=${p.trust_score}\n` +
        `📝 ${reason}\n` +
        `⚡ Dampak: ${impact}\n` +
        `🆔 <code>${s.id}</code>\n` +
        `📅 ${t}`;
    });
    await sendMessage(profile.telegram_chat_id,
      `<b>🛡️ Bot Signals (${signals.length})</b>\n\n${lines.join("\n\n")}`);
    return;
  }
  if (sub === "unban-signal") {
    const signalId = args[1];
    if (!signalId) { await sendMessage(profile.telegram_chat_id, "Usage: /admin unban-signal &lt;signal_id&gt;"); return; }
    const { data: ok, error: rpcErr } = await supabase.rpc("admin_cancel_bot_signal", {
      _signal_id: signalId,
      _admin_id: profile.id,
    });
    if (rpcErr || !ok) {
      await sendMessage(profile.telegram_chat_id, `❌ Gagal: ${rpcErr?.message ?? "Signal tidak ditemukan atau sudah diproses."}`);
      return;
    }
    // Notify the affected user
    const { data: sig } = await supabase.from("bot_signals").select("profile_id").eq("id", signalId).maybeSingle();
    if (sig) {
      const { data: u } = await supabase.from("profiles").select("telegram_chat_id, trust_score").eq("id", sig.profile_id).single();
      if (u) await safeSend(u.telegram_chat_id,
        `✅ <b>Deteksi otomatis dibatalkan oleh admin.</b>\n` +
        `Trust kamu dipulihkan +10 → <b>${u.trust_score}</b>.\n` +
        `Ban jika ada telah dihapus.`);
    }
    await sendMessage(profile.telegram_chat_id, `✅ Signal <code>${signalId}</code> dibatalkan. User di-unban & trust +10.`);
    return;
  }
  await sendMessage(profile.telegram_chat_id, "Subcommand tidak dikenal. /admin tanpa argumen untuk lihat daftar.");
}

async function handleStepInput(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  step: Step,
  text: string,
): Promise<boolean> {
  if (step.name === "idle") return false;

  if (step.name === "set_alias") {
    const alias = text.trim();
    if (alias.length < 3 || alias.length > 20) {
      await sendMessage(profile.telegram_chat_id, T.invalidAlias);
      return true;
    }
    await supabase.from("profiles").update({ alias }).eq("id", profile.id);
    await persistStep(supabase, profile.telegram_chat_id, { name: "set_gender" });
    await sendInlineKeyboard(profile.telegram_chat_id, T.promptGender, [[
      { text: "Pria", callback_data: "gender:male" },
      { text: "Wanita", callback_data: "gender:female" },
      { text: "Lainnya", callback_data: "gender:other" },
    ]]);
    return true;
  }

  if (step.name === "set_gender") {
    const map: Record<string, "male" | "female" | "other"> = {
      "pria": "male", "laki-laki": "male", "male": "male", "m": "male",
      "wanita": "female", "perempuan": "female", "female": "female", "f": "female",
      "lainnya": "other", "other": "other", "o": "other",
    };
    const g = map[text.trim().toLowerCase()];
    if (!g) {
      await sendInlineKeyboard(profile.telegram_chat_id, "Pilih salah satu:", [[
        { text: "Pria", callback_data: "gender:male" },
        { text: "Wanita", callback_data: "gender:female" },
        { text: "Lainnya", callback_data: "gender:other" },
      ]]);
      return true;
    }
    await supabase.from("profiles").update({ gender: g }).eq("id", profile.id);
    await persistStep(supabase, profile.telegram_chat_id, { name: "set_province" });
    await removeKeyboard(profile.telegram_chat_id, T.promptProvince);
    return true;
  }

  if (step.name === "set_province") {
    const prov = findProvinceByText(text);
    if (!prov) {
      await sendMessage(profile.telegram_chat_id, T.invalidProvince);
      return true;
    }
    await supabase.from("profiles").update({ province_code: prov.code, province_name: prov.name }).eq("id", profile.id);
    await persistStep(supabase, profile.telegram_chat_id, { name: "set_interests" });
    const current = await getInterests(supabase, profile.id);
    await sendMessage(profile.telegram_chat_id, T.promptInterests(current));
    return true;
  }

  if (step.name === "set_interests") {
    if (text.trim().toLowerCase() !== "skip") {
      const tags = text.split(",").map(t => t.trim()).filter(t => t.length >= 2 && t.length <= 30).slice(0, 10);
      if (tags.length) {
        await supabase.from("user_interests").delete().eq("profile_id", profile.id);
        const presetSet = new Set(PRESET_INTERESTS.map(p => p.toLowerCase()));
        const rows = tags.map(t => ({
          profile_id: profile.id,
          tag: t,
          kind: presetSet.has(t.toLowerCase()) ? "preset" : "custom",
        }));
        await supabase.from("user_interests").insert(rows);
      }
    }
    await persistStep(supabase, profile.telegram_chat_id, { name: "set_bio" });
    await sendMessage(profile.telegram_chat_id, T.promptBio);
    return true;
  }

  if (step.name === "set_bio") {
    if (text.trim().toLowerCase() !== "skip") {
      const bio = text.trim().slice(0, 200);
      await supabase.from("profiles").update({ bio }).eq("id", profile.id);
    }
    await supabase.from("profiles").update({ onboarding_completed: true, onboarding_step: null, pending_payment_ref: null }).eq("id", profile.id);
    stepByChat.set(profile.telegram_chat_id, { name: "idle" });
    const updated = await getProfileById(supabase, profile.id);
    const interests = await getInterests(supabase, profile.id);
    await sendMessage(profile.telegram_chat_id, T.profileDone(updated, interests));
    return true;
  }

  if (step.name === "await_payment_proof") {
    const proof = text.trim().slice(0, 500);
    if (proof.length < 5) {
      await sendMessage(
        profile.telegram_chat_id,
        "📷 Kirim <b>foto bukti transfer</b> sebagai gambar (bukan teks). AI akan memverifikasi nominal otomatis.\n\n" +
        "Salah kirim? Ketik /batal untuk membatalkan upload.",
      );
      return true;
    }
    await supabase
      .from("payment_requests")
      .update({ proof_note: proof, updated_at: new Date().toISOString() })
      .eq("reference_code", step.referenceCode)
      .eq("status", "pending");
    // Tetap di step await_payment_proof — supaya user bisa lanjut kirim foto
    await safeSend(
      profile.telegram_chat_id,
      "📝 Catatan tersimpan. Sekarang kirim <b>foto bukti transfer</b> sebagai gambar agar AI bisa verifikasi.\nKetik /batal untuk batalkan.",
    );
    return true;
  }

  if (step.name === "await_report_reason") {
    const reasonMap: Record<string, "spam" | "nsfw" | "bot" | "scam" | "harassment" | "other"> = {
      "spam": "spam",
      "asusila": "nsfw", "nsfw": "nsfw", "porno": "nsfw",
      "bot": "bot",
      "scam": "scam", "penipuan": "scam",
      "pelecehan": "harassment", "harassment": "harassment",
      "lainnya": "other", "other": "other",
    };
    const reason = reasonMap[text.trim().toLowerCase()];
    if (!reason) {
      await sendInlineKeyboard(profile.telegram_chat_id, "Pilih alasan dari tombol berikut:", [
        [
          { text: "Spam", callback_data: "report:spam" },
          { text: "Asusila", callback_data: "report:nsfw" },
          { text: "Bot", callback_data: "report:bot" },
        ],
        [
          { text: "Scam", callback_data: "report:scam" },
          { text: "Pelecehan", callback_data: "report:harassment" },
          { text: "Lainnya", callback_data: "report:other" },
        ],
        [{ text: "❎ Batal", callback_data: "report:cancel" }],
      ]);
      return true;
    }
    await submitReport(supabase, profile, step, reason);
    return true;
  }

  return false;
}

// Shared report submission logic (dipakai oleh teks & callback_query).
async function submitReport(
  supabase: ReturnType<typeof getSupabase>,
  profile: Profile,
  step: { conversationId: string; reportedId: string },
  reason: "spam" | "nsfw" | "bot" | "scam" | "harassment" | "other",
) {
  const { data: existing } = await supabase
    .from("user_reports")
    .select("id")
    .eq("reporter_id", profile.id)
    .eq("reported_id", step.reportedId)
    .eq("conversation_id", step.conversationId)
    .maybeSingle();

  if (existing) {
    await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
    await safeSend(profile.telegram_chat_id, T.reportAlready);
    return;
  }

  await supabase.from("user_reports").insert({
    reporter_id: profile.id,
    reported_id: step.reportedId,
    conversation_id: step.conversationId,
    reason,
  });

  const reported = await getProfileById(supabase, step.reportedId);
  const banned = !!reported.is_banned_until && new Date(reported.is_banned_until) > new Date();
  const banUntil = banned ? new Date(reported.is_banned_until!).toLocaleString("id-ID") : null;
  const reasonText = `Report terverifikasi (${reason})${banned ? " · auto-ban 24 jam tercapai" : ""}`;

  await supabase.from("trust_events").insert({
    profile_id: reported.id,
    conversation_id: step.conversationId,
    event_type: banned ? "ban" : "reported",
    delta: -5,
    new_score: reported.trust_score,
    reason: reasonText,
  });

  const conv = await getActiveConversation(supabase, profile.id);
  if (conv && conv.id === step.conversationId) {
    await endConversation(supabase, conv, profile.id);
  }

  await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
  await safeSend(profile.telegram_chat_id, T.reportSuccess);
  await safeSend(profile.telegram_chat_id, T.reportSummaryReporter(profile.trust_score));
  if (reported.telegram_user_id !== AI_TELEGRAM_USER_ID) {
    await safeSend(reported.telegram_chat_id, T.partnerLeft);
    await safeSend(reported.telegram_chat_id, T.reportSummaryReported(reported.trust_score, banned, banUntil));
  }
}

// ============= Rate limit wrapper =============
async function checkRate(
  supabase: ReturnType<typeof getSupabase>,
  profileId: string,
  bucket: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    _profile_id: profileId,
    _bucket: bucket,
    _max_count: max,
    _window_seconds: windowSec,
  });
  if (error) {
    console.error("check_rate_limit failed", error);
    return true; // fail-open
  }
  return !!data;
}

// ============= /nonai — toggle AI Companion preference =============
async function handleNoAi(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  try {
    const newVal = !profile.no_ai;
    const { error } = await supabase.from("profiles").update({ no_ai: newVal }).eq("id", profile.id);
    if (error) throw error;
    await safeSend(profile.telegram_chat_id, newVal ? T.nonaiEnabled : T.nonaiDisabled);
  } catch (e) {
    console.error("handleNoAi failed", e);
    await safeSend(
      profile.telegram_chat_id,
      `❌ Gagal mengubah pengaturan AI. Pastikan profil kamu sudah lengkap (/profile) dan coba lagi.`,
    );
  }
}

// ============= /ai — show AI Companion status & history =============
async function handleAiStatus(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  try {
    const aiProfileId = await ensureAiProfile(supabase);
    const conv = await getActiveConversation(supabase, profile.id);
    const isInAiConv = !!conv && (conv.user_a === aiProfileId || conv.user_b === aiProfileId);

    const noAiLine = profile.no_ai
      ? `\ud83d\udeab Mode /nonai: <b>Aktif</b> (AI Companion ditolak)`
      : `\u2705 Mode /nonai: Tidak aktif (AI bisa auto-aktif setelah 60 detik)`;

    if (!isInAiConv || !conv) {
      await safeSend(
        profile.telegram_chat_id,
        `\ud83e\udd16 <b>AI Companion Status</b>\n\n` +
        `\ud83d\udce1 Status: \u274c Tidak aktif\n` +
        `${noAiLine}\n\n` +
        `<i>AI Companion akan otomatis aktif jika tidak ada match dalam 60 detik.\n` +
        `Ketik /nonai untuk menolak AI Companion.</i>`,
      );
      return;
    }

    // Fetch last 5 AI messages in this conversation
    const { data: aiMessages } = await supabase
      .from("messages")
      .select("content, created_at")
      .eq("conversation_id", conv.id)
      .eq("sender_id", aiProfileId)
      .order("created_at", { ascending: false })
      .limit(5);

    const startedAt = new Date(conv.started_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });

    const msgLines = aiMessages && aiMessages.length > 0
      ? aiMessages
          .slice()
          .reverse()
          .map((m: { content: string; created_at: string }, i: number) => {
            const t = new Date(m.created_at).toLocaleString("id-ID", { timeStyle: "short" });
            const snippet = String(m.content).slice(0, 80);
            const ellipsis = String(m.content).length > 80 ? "\u2026" : "";
            return `${i + 1}. \u201c${snippet}${ellipsis}\u201d\n   <i>${t}</i>`;
          })
          .join("\n")
      : `<i>Belum ada pesan dari AI.</i>`;

    await safeSend(
      profile.telegram_chat_id,
      `\ud83e\udd16 <b>AI Companion Status</b>\n\n` +
      `\ud83d\udce1 Status: \u2705 <b>Aktif</b> (sedang ngobrol dengan AI)\n` +
      `\u23f0 Mulai menyapa: ${startedAt}\n` +
      `${noAiLine}\n\n` +
      `\ud83d\udcac <b>5 pesan terakhir dari AI:</b>\n${msgLines}\n\n` +
      `<i>\u2139\ufe0f AI Companion transparan \u2014 bukan manusia.\n` +
      `Ketik /stop untuk akhiri, /nonai untuk matikan AI.</i>`,
    );
  } catch (e) {
    console.error("handleAiStatus failed", e);
    await safeSend(
      profile.telegram_chat_id,
      `❌ Gagal mengambil status AI Companion. Coba lagi nanti.\n` +
      `<i>Jika masalah berlanjut, ketik /stop lalu /cari.</i>`,
    );
  }
}

// ============= Callback query (inline button taps) =============
async function handleCallbackQuery(
  supabase: ReturnType<typeof getSupabase>,
  cq: TgCallbackQuery,
) {
  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  if (!chatId) {
    await answerCallbackQuery(cq.id);
    return;
  }

  // Build a synthetic msg for ensureProfile
  const synthetic: TgMessage = {
    message_id: messageId ?? 0,
    from: cq.from,
    chat: { id: chatId, type: "private" },
    date: Math.floor(Date.now() / 1000),
  };
  const profile = await ensureProfile(supabase, synthetic);
  const step = await loadStep(supabase, chatId, profile);

  const [ns, action] = data.split(":");

  // Gender selection (onboarding)
  if (ns === "gender" && step.name === "set_gender") {
    const map: Record<string, "male" | "female" | "other"> = { male: "male", female: "female", other: "other" };
    const g = map[action];
    if (!g) {
      await answerCallbackQuery(cq.id, "Pilihan tidak valid");
      return;
    }
    await supabase.from("profiles").update({ gender: g }).eq("id", profile.id);
    await persistStep(supabase, chatId, { name: "set_province" });
    if (messageId) await editMessageReplyMarkup(chatId, messageId, null);
    await answerCallbackQuery(cq.id, `Gender: ${g === "male" ? "Pria" : g === "female" ? "Wanita" : "Lainnya"}`);
    await sendMessage(chatId, T.promptProvince);
    return;
  }

  // Report reason selection
  if (ns === "report" && step.name === "await_report_reason") {
    if (action === "cancel") {
      await persistStep(supabase, chatId, { name: "idle" });
      if (messageId) await editMessageReplyMarkup(chatId, messageId, null);
      await answerCallbackQuery(cq.id, "Dibatalkan");
      await sendMessage(chatId, "❎ Laporan dibatalkan.");
      return;
    }
    const valid = ["spam", "nsfw", "bot", "scam", "harassment", "other"] as const;
    if (!valid.includes(action as typeof valid[number])) {
      await answerCallbackQuery(cq.id, "Pilihan tidak valid");
      return;
    }
    if (messageId) await editMessageReplyMarkup(chatId, messageId, null);
    await answerCallbackQuery(cq.id, "Laporan diproses…");
    await submitReport(supabase, profile, { conversationId: step.conversationId, reportedId: step.reportedId }, action as typeof valid[number]);
    return;
  }

  // Unban severity selection
  if (ns === "unban") {
    if (messageId) await editMessageReplyMarkup(chatId, messageId, null);
    await answerCallbackQuery(cq.id);
    await handleUnban(supabase, profile, action);
    return;
  }

  // Quick command shortcuts (used by /start menu)
  if (ns === "cmd") {
    if (messageId) await editMessageReplyMarkup(chatId, messageId, null);
    await answerCallbackQuery(cq.id);
    switch (action) {
      case "cari": return handleCari(supabase, profile, "any");
      case "stop": return handleStop(supabase, profile);
      case "profile": return handleProfileStart(supabase, profile);
      case "me": return handleMe(supabase, profile);
      case "premium": return handlePremium(profile);
      case "upgrade": return handleUpgrade(supabase, profile);
      case "unban": return handleUnban(supabase, profile, null);
      case "help": return handleHelp(profile);
    }
    return;
  }

  await answerCallbackQuery(cq.id);
}

export async function processUpdate(supabase: ReturnType<typeof getSupabase>, update: TgUpdate) {
  // Handle callback_query (inline button taps) — no popup keyboard.
  if (update.callback_query) {
    await handleCallbackQuery(supabase, update.callback_query);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.from) return;
  // Accept text OR photo (foto bukti transfer)
  if (!msg.text && !(msg.photo && msg.photo.length > 0)) return;

  const { data: existing } = await supabase
    .from("telegram_updates_log")
    .select("update_id")
    .eq("update_id", update.update_id)
    .maybeSingle();
  if (existing) return;

  await supabase.from("telegram_updates_log").insert({
    update_id: update.update_id,
    chat_id: msg.chat.id,
    from_user_id: msg.from.id,
    raw_update: update,
  });

  const profile = await ensureProfile(supabase, msg);

  if (profile.is_banned_until && new Date(profile.is_banned_until) > new Date()) {
    // Tetap izinkan /unban + /batal walau di-ban
    const banText = (msg.text ?? "").trim().toLowerCase();
    if (!banText.startsWith("/unban") && !banText.startsWith("/batal") && !banText.startsWith("/cancel") && !banText.startsWith("/start") && !banText.startsWith("/help")) {
      await sendMessage(profile.telegram_chat_id, T.bannedUntil(new Date(profile.is_banned_until).toLocaleString("id-ID")));
      return;
    }
  }

  // Global rate limit: 30 events / 60s per user
  const allowed = await checkRate(supabase, profile.id, "global", 30, 60);
  if (!allowed) {
    await sendMessage(profile.telegram_chat_id, T.rateLimited("global", 60));
    return;
  }

  // Photo path: jika user kirim foto, route ke proof handler
  if (msg.photo && msg.photo.length > 0) {
    await handlePhotoProof(supabase, profile, msg);
    return;
  }

  const text = (msg.text ?? "").trim();
  // Hard input cap (defense)
  if (text.length > 2000) {
    await sendMessage(profile.telegram_chat_id, "❌ Pesan terlalu panjang (max 2000 karakter).");
    return;
  }

  const parts = text.startsWith("/") ? text.split(/\s+/) : [];
  const cmd = parts.length > 0 ? parts[0].split("@")[0].toLowerCase() : null;
  const arg1 = parts[1] ?? null;

  if (cmd) {
    // Per-command rate limits
    const limits: Record<string, [number, number]> = {
      "/cari": [10, 60], "/find": [10, 60], "/match": [10, 60],
      "/stop": [20, 60], "/end": [20, 60],
      "/report": [5, 300], "/block": [10, 300],
      "/upgrade": [3, 300],
    };
    const lim = limits[cmd];
    if (lim) {
      const ok = await checkRate(supabase, profile.id, `cmd:${cmd}`, lim[0], lim[1]);
      if (!ok) { await sendMessage(profile.telegram_chat_id, T.rateLimited(cmd, lim[1])); return; }
    }

    // Don't reset step for /cari/batal/cancel if we're in a flow (e.g. payment proof)
    const currentStep = stepByChat.get(profile.telegram_chat_id);
    const preserveStep = cmd === "/help" || cmd === "/me" || cmd === "/batal" || cmd === "/cancel" || currentStep?.name === "await_payment_proof";
    if (!preserveStep) {
      await persistStep(supabase, profile.telegram_chat_id, { name: "idle" });
    }

    switch (cmd) {
      case "/start": return handleStart(supabase, profile);
      case "/help": return handleHelp(profile);
      case "/profile": return handleProfileStart(supabase, profile);
      case "/me": return handleMe(supabase, profile);
      case "/cari":
      case "/find":
      case "/match": return handleCari(supabase, profile, parseTrustFilter(arg1));
      case "/stop":
      case "/end": return handleStop(supabase, profile);
      case "/report": return handleReport(supabase, profile);
      case "/block": return handleBlock(supabase, profile);
      case "/premium": return handlePremium(profile);
      case "/upgrade": return handleUpgrade(supabase, profile);
      case "/unban": return handleUnban(supabase, profile, arg1);
      case "/batal":
      case "/cancel": return handleCancelProof(supabase, profile);
      case "/admin": return handleAdmin(supabase, profile, parts.slice(1));
      case "/nonai": return handleNoAi(supabase, profile);
      case "/ai": return handleAiStatus(supabase, profile);
      default:
        await sendMessage(profile.telegram_chat_id, `Perintah tidak dikenal. Ketik /help.`);
        return;
    }
  }

  // Load step from DB (safe for cold-starts, falls back to idle)
  const step = await loadStep(supabase, profile.telegram_chat_id, profile);
  const handled = await handleStepInput(supabase, profile, step, text);
  if (handled) return;

  const conv = await getActiveConversation(supabase, profile.id);
  if (!conv) {
    await sendMessage(profile.telegram_chat_id, `ℹ️ Kamu tidak sedang ngobrol. Ketik /cari untuk mulai.`);
    return;
  }
  const partnerId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  const partner = await getProfileById(supabase, partnerId);

  // Per-conversation message rate limit (anti-spam): 30 msgs / 30s
  const msgOk = await checkRate(supabase, profile.id, "msg", 30, 30);
  if (!msgOk) {
    await sendMessage(profile.telegram_chat_id, T.rateLimited("msg", 30));
    return;
  }

  // Bot/spam/scam detection (behavioral + AI sample)
  const count = (msgCountByConv.get(conv.id) ?? 0) + 1;
  msgCountByConv.set(conv.id, count);
  const detection = await applyDetection(supabase, profile.id, conv.id, text, count).catch((e) => {
    console.error("applyDetection failed", e);
    return { flagged: false, banned: false, banUntil: null, reason: "" };
  });

  if (detection.flagged) {
    const penaltyScore = Math.max(0, profile.trust_score - 10);
    await safeSend(profile.telegram_chat_id, T.detectionWarning(detection.reason, detection.banned, penaltyScore));
    if (partner.telegram_user_id !== AI_TELEGRAM_USER_ID) {
      await safeSend(partner.telegram_chat_id, T.partnerSanctioned(detection.banned));
    }
    if (detection.banned) {
      await endConversation(supabase, conv, profile.id);
      return;
    }
    // For non-severe flags, drop the offending message
    await safeSend(profile.telegram_chat_id, T.contentBlocked);
    return;
  }

  // Persist & route message
  await supabase.from("messages").insert({
    conversation_id: conv.id,
    sender_id: profile.id,
    content: text.slice(0, 2000),
    telegram_message_id: msg.message_id,
  });

  // AI Companion routing
  const { ai } = await isAiConversation(supabase, conv);
  if (ai) {
    await aiReply(supabase, conv.id, profile.id, profile.telegram_chat_id, text).catch((e) => {
      console.error("aiReply failed", e);
    });
    return;
  }

  // Forward message — escape HTML to prevent tag injection between users
  await safeSend(partner.telegram_chat_id, escapeHtml(text.slice(0, 2000)));
}
