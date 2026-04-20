// Shared Telegram update processor — used by both telegram-poll (cron) and telegram-webhook (instant).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendMessage, sendKeyboard, removeKeyboard } from "./telegram.ts";
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
    `/cari — cari teman ngobrol baru\n` +
    `/stop — akhiri obrolan saat ini / keluar antrean\n` +
    `/report — laporkan lawan chat (spam/asusila/bot/scam)\n` +
    `/block — blokir lawan chat agar tidak di-match lagi\n` +
    `/me — lihat profil kamu\n` +
    `/premium — info upgrade premium\n` +
    `/help — bantuan`,
  needOnboarding: `⚠️ Profil kamu belum lengkap. Ketik /profile dulu.`,
  bannedUntil: (until: string) => `🚫 Akun kamu sedang di-ban sampai <b>${until}</b>. Ketik /premium untuk info unban.`,
  searching: (sameProv: boolean, provName: string | null) =>
    sameProv
      ? `🔎 Mencari teman ngobrol dari <b>${provName}</b>…`
      : `🔎 Mencari teman ngobrol…`,
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
  blockAlready: `ℹ️ User ini sudah ada di daftar block kamu.`,
  promptAlias: `Ketik <b>nama alias</b> kamu (3–20 karakter, akan ditampilkan ke lawan chat):`,
  promptGender: `Pilih <b>gender</b> kamu:`,
  promptProvince: `Ketik <b>nama provinsi</b> kamu (mis. "DKI Jakarta", "Jawa Barat"):`,
  promptInterests: (current: string[]) =>
    `Ketik <b>minat</b> kamu, dipisah koma. Contoh: <code>Musik, Coding, Anime</code>\n\n` +
    `Preset: ${PRESET_INTERESTS.slice(0, 12).join(", ")}, …\n\n` +
    (current.length ? `Saat ini: <i>${current.join(", ")}</i>\n\nKetik <code>skip</code> untuk lewati.` : `Ketik <code>skip</code> untuk lewati.`),
  promptBio: `Ketik <b>bio singkat</b> (maks 200 karakter), atau <code>skip</code>:`,
  profileDone: (p: Profile, interests: string[]) =>
    `✅ <b>Profil kamu</b>\n\n` +
    `👤 ${p.alias}\n` +
    `⚧ ${p.gender ?? "-"}\n` +
    `📍 ${p.province_name ?? "-"}\n` +
    `🎯 ${interests.length ? interests.join(", ") : "-"}\n` +
    `📝 ${p.bio ?? "-"}\n` +
    `⭐ Trust: ${p.trust_score}\n\n` +
    `Ketik /cari untuk mulai ngobrol!`,
  invalidAlias: `❌ Alias harus 3–20 karakter.`,
  invalidProvince: `❌ Provinsi tidak ditemukan. Coba lagi (mis. "Jawa Barat"):`,
  premiumOnlyGenderFilter: `⭐ Filter gender hanya untuk Premium. Preferensi diset ke "any".`,
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

async function tryMatch(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  await supabase.from("match_queue").upsert(
    {
      profile_id: profile.id,
      province_code: profile.province_code,
      gender: profile.gender,
      gender_preference: profile.is_premium ? profile.gender_preference : "any",
      is_premium: profile.is_premium,
      status: "waiting",
      joined_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );

  const { data: candidates } = await supabase
    .from("match_queue")
    .select("*")
    .eq("status", "waiting")
    .neq("profile_id", profile.id)
    .order("joined_at", { ascending: true })
    .limit(50);

  if (!candidates || candidates.length === 0) return null;

  // Ambil daftar block dua arah
  const { data: blocks } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${profile.id},blocked_id.eq.${profile.id}`);
  const blockedSet = new Set<string>();
  for (const b of blocks ?? []) {
    blockedSet.add(b.blocker_id === profile.id ? b.blocked_id : b.blocker_id);
  }

  const myInterests = new Set(await getInterests(supabase, profile.id));
  const myPref = profile.is_premium ? profile.gender_preference : "any";

  type Scored = { entry: typeof candidates[number]; score: number };
  const scored: Scored[] = [];

  for (const c of candidates) {
    if (myPref !== "any" && c.gender && c.gender !== myPref) continue;
    if (c.is_premium && c.gender_preference !== "any" && profile.gender && c.gender_preference !== profile.gender) continue;

    let score = 0;
    if (profile.province_code && c.province_code === profile.province_code) score += 3;
    if (myPref !== "any" && c.gender === myPref) score += 2;
    const theirInterests = await getInterests(supabase, c.profile_id);
    const overlap = theirInterests.filter(t => myInterests.has(t)).length;
    score += overlap;
    scored.push({ entry: c, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || new Date(a.entry.joined_at).getTime() - new Date(b.entry.joined_at).getTime());
  const best = scored[0];

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

async function handleMe(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
  const interests = await getInterests(supabase, profile.id);
  await sendMessage(profile.telegram_chat_id, T.profileDone(profile, interests));
}

async function handleHelp(profile: Profile) {
  await sendMessage(profile.telegram_chat_id, T.help);
}

async function handlePremium(profile: Profile) {
  await sendMessage(profile.telegram_chat_id, T.premium);
}

async function handleCari(supabase: ReturnType<typeof getSupabase>, profile: Profile) {
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
  await sendMessage(profile.telegram_chat_id, T.searching(true, profile.province_name));

  const result = await tryMatch(supabase, profile);
  if (!result) {
    await sendMessage(profile.telegram_chat_id, T.inQueue);
    return;
  }

  const { partner, sameProvince } = result;
  await sendMessage(profile.telegram_chat_id, T.matchFound(partner.alias, partner.province_name ?? "-", sameProvince));
  await sendMessage(partner.telegram_chat_id, T.matchFound(profile.alias, profile.province_name ?? "-", sameProvince));
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
  await supabase
    .from("conversations")
    .update({ status: "ended", ended_at: new Date().toISOString(), ended_by: profile.id })
    .eq("id", conv.id);
  const partnerId = conv.user_a === profile.id ? conv.user_b : conv.user_a;
  const partner = await getProfileById(supabase, partnerId);
  await sendMessage(profile.telegram_chat_id, T.youLeft);
  await sendMessage(partner.telegram_chat_id, T.partnerLeft);
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
