// Shared Telegram update processor — used by both telegram-poll (cron) and telegram-webhook (instant).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendMessage, sendKeyboard, removeKeyboard, safeSend } from "./telegram.ts";
import { PROVINCES_ID, PRESET_INTERESTS, findProvinceByText } from "./provinces-id.ts";

export type TgUser = { id: number; username?: string; first_name?: string; language_code?: string };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  date: number;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

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
  is_banned_until: string | null;
  onboarding_completed: boolean;
};

type Step =
  | { name: "idle" }
  | { name: "set_alias" }
  | { name: "set_gender" }
  | { name: "set_province" }
  | { name: "set_interests" }
  | { name: "set_bio" }
  | { name: "set_gender_pref" }
  | { name: "await_report_reason"; conversationId: string; reportedId: string };
const stepByChat = new Map<number, Step>();

export function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key);
}

const T = {
  welcome: (alias: string) =>
    `👋 Halo <b>${alias}</b>! Selamat datang di <b>Rizztalk</b> — random chat anonim untuk Indonesia.\n\n` +
    `Sebelum mulai, lengkapi profil dulu dengan /profile.\n\nKetik /help untuk lihat semua perintah.`,
  help:
    `<b>Perintah Rizztalk</b>\n\n` +
    `/start — mulai / lihat status\n` +
    `/profile — atur profil (gender, lokasi, minat, bio)\n` +
    `/cari [filter] — cari teman ngobrol baru\n` +
    `   filter: <code>normal</code> (≥60) · <code>terpercaya</code> (≥90) · <code>sangat_terpercaya</code> (≥120)\n` +
    `   contoh: <code>/cari terpercaya</code>\n` +
    `/stop — akhiri obrolan saat ini / keluar antrean\n` +
    `/report — laporkan lawan chat (spam/asusila/bot/scam)\n` +
    `/block — blokir lawan chat agar tidak di-match lagi\n` +
    `/me — lihat profil & riwayat trust score kamu\n` +
    `/premium — info upgrade premium\n` +
    `/help — bantuan`,
  needOnboarding: `⚠️ Profil kamu belum lengkap. Ketik /profile dulu.`,
  bannedUntil: (until: string) => `🚫 Akun kamu sedang di-ban sampai <b>${until}</b>. Ketik /premium untuk info unban.`,
  searching: (sameProv: boolean, provName: string | null, filter: TrustFilter = "any") => {
    const base = sameProv
      ? `🔎 Mencari teman ngobrol dari <b>${provName}</b>…`
      : `🔎 Mencari teman ngobrol…`;
    return filter === "any" ? base : `${base}\n<i>Filter trust: ${trustFilterLabel(filter)} (otomatis dilonggarkan jika menunggu lama).</i>`;
  },
  inQueue: `⏳ Kamu sudah di antrean. Tunggu sebentar…`,
  alreadyChatting: `💬 Kamu sedang dalam obrolan. Ketik /stop untuk mengakhiri.`,
  matchFound: (alias: string, provName: string, sameProv: boolean) => {
    const banner = sameProv
      ? `✅ Match ditemukan dari provinsi yang sama!`
      : `ℹ️ <i>Tidak ditemukan user dari lokasi yang sama.</i>\nKamu di-match dengan user dari provinsi lain.`;
    return `${banner}\n\n💬 Kamu sekarang ngobrol dengan <b>${alias}</b> (${provName}).\nKetik /stop untuk akhiri.`;
  },
  partnerLeft: `👋 Lawan bicara mengakhiri obrolan. Ketik /cari untuk cari yang baru.`,
  youLeft: `✅ Obrolan diakhiri. Ketik /cari untuk cari yang baru.`,
  notInChat: `ℹ️ Kamu tidak sedang dalam obrolan. Ketik /cari untuk mulai.`,
  cancelled: `❎ Pencarian dibatalkan.`,
  premium:
    `⭐ <b>Rizztalk Premium</b>\n\n` +
    `• Filter gender (cari khusus pria/wanita)\n` +
    `• Chat dengan orang sebelumnya\n` +
    `• Skip antrean lebih cepat\n` +
    `• Unban instan\n\n` +
    `Pembayaran segera tersedia (Midtrans + transfer manual).`,
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
    return `✅ <b>Profil kamu</b>\n\n` +
      `👤 ${p.alias}\n` +
      `⚧ ${p.gender ?? "-"}\n` +
      `📍 ${p.province_name ?? "-"}\n` +
      `🎯 ${interests.length ? interests.join(", ") : "-"}\n` +
      `📝 ${p.bio ?? "-"}\n\n` +
      `⭐ <b>Trust Score</b>: <b>${p.trust_score}</b> / 150 — ${label}\n` +
      `<code>${bar}</code>\n\n` +
      `<b>📜 Riwayat trust (5 terakhir):</b>\n${historyBlock}\n\n` +
      `<b>Aturan perubahan skor:</b>\n` +
      `• /stop &lt; 30 detik → <b>−3</b> (pemutus)\n` +
      `• Chat ≥ 5 menit tanpa report → <b>+3</b> (kedua pihak)\n` +
      `• Di-report (terverifikasi) → <b>−5</b>; 5 report dlm 24 jam → ban 24 jam\n` +
      `• Di-block lawan → <b>−3</b>\n` +
      `<i>Skor &lt; 70 = antrean lebih lambat. Filter trust di /cari otomatis dilonggarkan setelah 90 detik.</i>\n\n` +
      `Ketik /cari untuk mulai ngobrol!`;
  },
  trustSummary: (delta: number, newScore: number, reason: string) => {
    const sign = delta > 0 ? "+" : "";
    const emoji = delta > 0 ? "📈" : delta < 0 ? "📉" : "➖";
    return `${emoji} <b>Trust score</b>: ${sign}${delta} → <b>${newScore}</b>\n<i>${reason}</i>`;
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

// Filter trust untuk /cari — opsi dipilih user.
// "Anti-kelaparan" tetap berlaku: filter hanya MEMPERSEMPIT kandidat,
// tidak mengubah threshold/wait-boost. Setelah waktu tertentu filter di-relax otomatis.
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

// Anti-kelaparan untuk filter trust: setelah 90 detik antrean,
// minimum trust kandidat diturunkan bertahap (relaxed) sampai 0.
function effectiveTrustMin(filter: TrustFilter, waitSec: number): number {
  const base = trustFilterMin(filter);
  if (base === 0) return 0;
  const relaxedSteps = Math.floor(Math.max(0, waitSec - 90) / 60); // tiap 60s setelah 90s
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

  // Threshold dinamis untuk requester low-trust, di-relax oleh wait.
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

  const { data: candidates } = await supabase
    .from("match_queue")
    .select("profile_id, province_code, gender, gender_preference, is_premium, joined_at")
    .eq("status", "waiting")
    .neq("profile_id", profile.id)
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
  if (!profile.onboarding_completed) {
    stepByChat.set(profile.telegram_chat_id, { name: "set_alias" });
    await sendMessage(profile.telegram_chat_id, T.promptAlias);
  }
}

async function handleProfileStart(profile: Profile) {
  stepByChat.set(profile.telegram_chat_id, { name: "set_alias" });
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

async function handlePremium(profile: Profile) {
  await sendMessage(profile.telegram_chat_id, T.premium);
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
  await sendMessage(profile.telegram_chat_id, T.searching(true, profile.province_name, trustFilter));

  const result = await tryMatch(supabase, profile, trustFilter);
  if (!result) {
    await sendMessage(profile.telegram_chat_id, T.inQueue);
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
  const durationSec = (endedAt.getTime() - new Date(conv.started_at).getTime()) / 1000;
  return { durationSec };
}

// Aturan trust dinamis berbasis durasi chat:
// - <30 detik (yang /stop): -3 untuk pemutus (terlalu cepat menyerah/spam-skip)
// - 30s–5 menit: netral (0)
// - >=5 menit tanpa report: +3 untuk kedua pihak
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
  const { ender, partner: partnerDelta } = trustDeltasFromDuration(durationSec);
  const reason = trustReason(durationSec);
  const durInt = Math.round(durationSec);

  // Catat event + ubah skor (dipakai juga di /me history). Selalu kirim ringkasan ke kedua pihak.
  const enderNew = ender !== 0
    ? await recordTrustEvent(supabase, profile.id, ender, "stop", reason, conversationId, durInt)
    : profile.trust_score;
  const partnerNew = partnerDelta !== 0
    ? await recordTrustEvent(supabase, partner.id, partnerDelta, "stop", reason, conversationId, durInt)
    : partner.trust_score;

  if (enderNew !== null) {
    await safeSend(profile.telegram_chat_id, T.trustSummary(ender, enderNew, reason));
  }
  if (partnerNew !== null) {
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
  // Selalu coba kirim ke kedua pihak — safeSend tidak melempar walau salah satu chat_id mati.
  await safeSend(profile.telegram_chat_id, T.youLeft);
  await safeSend(partner.telegram_chat_id, T.partnerLeft);
  await applyEndTrust(supabase, profile, partner, conv.id, durationSec);
}

async function handleReport(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const conv = await getActiveConversation(supabase, profile.id);
  if (!conv) {
    await sendMessage(profile.telegram_chat_id, T.reportNoChat);
    return;
  }
  const reportedId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  stepByChat.set(profile.telegram_chat_id, {
    name: "await_report_reason",
    conversationId: conv.id,
    reportedId,
  });
  await sendKeyboard(profile.telegram_chat_id, T.reportPrompt, [
    ["Spam", "Asusila", "Bot"],
    ["Scam", "Pelecehan", "Lainnya"],
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
    stepByChat.set(profile.telegram_chat_id, { name: "set_gender" });
    await sendKeyboard(profile.telegram_chat_id, T.promptGender, [["Pria", "Wanita", "Lainnya"]]);
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
      await sendKeyboard(profile.telegram_chat_id, "Pilih dari tombol di bawah:", [["Pria", "Wanita", "Lainnya"]]);
      return true;
    }
    await supabase.from("profiles").update({ gender: g }).eq("id", profile.id);
    stepByChat.set(profile.telegram_chat_id, { name: "set_province" });
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
    stepByChat.set(profile.telegram_chat_id, { name: "set_interests" });
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
    stepByChat.set(profile.telegram_chat_id, { name: "set_bio" });
    await sendMessage(profile.telegram_chat_id, T.promptBio);
    return true;
  }

  if (step.name === "set_bio") {
    if (text.trim().toLowerCase() !== "skip") {
      const bio = text.trim().slice(0, 200);
      await supabase.from("profiles").update({ bio }).eq("id", profile.id);
    }
    await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", profile.id);
    stepByChat.set(profile.telegram_chat_id, { name: "idle" });
    const updated = await getProfileById(supabase, profile.id);
    const interests = await getInterests(supabase, profile.id);
    await sendMessage(profile.telegram_chat_id, T.profileDone(updated, interests));
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
      await sendKeyboard(profile.telegram_chat_id, "Pilih dari tombol di bawah:", [
        ["Spam", "Asusila", "Bot"],
        ["Scam", "Pelecehan", "Lainnya"],
      ]);
      return true;
    }

    const { data: existing } = await supabase
      .from("user_reports")
      .select("id")
      .eq("reporter_id", profile.id)
      .eq("reported_id", step.reportedId)
      .eq("conversation_id", step.conversationId)
      .maybeSingle();

    if (existing) {
      stepByChat.set(profile.telegram_chat_id, { name: "idle" });
      await removeKeyboard(profile.telegram_chat_id, T.reportAlready);
      return true;
    }

    await supabase.from("user_reports").insert({
      reporter_id: profile.id,
      reported_id: step.reportedId,
      conversation_id: step.conversationId,
      reason,
    });

    // Trigger DB handle_new_report sudah turunkan trust −5 & set ban jika perlu.
    // Ambil state terbaru reported untuk notifikasi spesifik + catat trust event.
    const reported = await getProfileById(supabase, step.reportedId);
    const banned = !!reported.is_banned_until && new Date(reported.is_banned_until) > new Date();
    const banUntil = banned ? new Date(reported.is_banned_until!).toLocaleString("id-ID") : null;
    const reasonText = `Report terverifikasi (${reason})${banned ? " · auto-ban 24 jam tercapai" : ""}`;

    // Catat sebagai event riwayat untuk yang di-report (delta -5 sudah diaplikasikan trigger,
    // jadi kita pakai delta=-5 dengan new_score=skor saat ini untuk audit trail).
    await supabase.from("trust_events").insert({
      profile_id: reported.id,
      conversation_id: step.conversationId,
      event_type: banned ? "ban" : "reported",
      delta: -5,
      new_score: reported.trust_score,
      reason: reasonText,
    });

    const conv = await getActiveConversation(supabase, profile.id);
    let durationSec = 0;
    if (conv && conv.id === step.conversationId) {
      durationSec = Math.round((Date.now() - new Date(conv.started_at).getTime()) / 1000);
      await endConversation(supabase, conv, profile.id);
    }

    stepByChat.set(profile.telegram_chat_id, { name: "idle" });

    // Notifikasi terverifikasi ke kedua pihak (tahan-error)
    try { await removeKeyboard(profile.telegram_chat_id, T.reportSuccess); }
    catch (e) { console.error("removeKeyboard failed", e); await safeSend(profile.telegram_chat_id, T.reportSuccess); }
    await safeSend(profile.telegram_chat_id, T.reportSummaryReporter(profile.trust_score));
    await safeSend(reported.telegram_chat_id, T.partnerLeft);
    await safeSend(reported.telegram_chat_id, T.reportSummaryReported(reported.trust_score, banned, banUntil));
    return true;
  }

  return false;
}

export async function processUpdate(supabase: ReturnType<typeof getSupabase>, update: TgUpdate) {
  const msg = update.message;
  if (!msg || !msg.from || !msg.text) return;

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
    await sendMessage(profile.telegram_chat_id, T.bannedUntil(new Date(profile.is_banned_until).toLocaleString("id-ID")));
    return;
  }

  const text = msg.text.trim();
  const cmd = text.startsWith("/") ? text.split(/\s+/)[0].split("@")[0].toLowerCase() : null;

  if (cmd) {
    stepByChat.set(profile.telegram_chat_id, { name: "idle" });
    switch (cmd) {
      case "/start": return handleStart(supabase, profile);
      case "/help": return handleHelp(profile);
      case "/profile": return handleProfileStart(profile);
      case "/me": return handleMe(supabase, profile);
      case "/cari":
      case "/find":
      case "/match": return handleCari(supabase, profile);
      case "/stop":
      case "/end": return handleStop(supabase, profile);
      case "/report": return handleReport(supabase, profile);
      case "/block": return handleBlock(supabase, profile);
      case "/premium": return handlePremium(profile);
      default:
        await sendMessage(profile.telegram_chat_id, `Perintah tidak dikenal. Ketik /help.`);
        return;
    }
  }

  const step = stepByChat.get(profile.telegram_chat_id) ?? { name: "idle" };
  const handled = await handleStepInput(supabase, profile, step, text);
  if (handled) return;

  const conv = await getActiveConversation(supabase, profile.id);
  if (!conv) {
    await sendMessage(profile.telegram_chat_id, `ℹ️ Kamu tidak sedang ngobrol. Ketik /cari untuk mulai.`);
    return;
  }
  const partnerId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  const partner = await getProfileById(supabase, partnerId);

  await supabase.from("messages").insert({
    conversation_id: conv.id,
    sender_id: profile.id,
    content: text.slice(0, 2000),
    telegram_message_id: msg.message_id,
  });

  await sendMessage(partner.telegram_chat_id, text.slice(0, 2000));
}
