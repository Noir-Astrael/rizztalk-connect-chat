// Lightweight behavioral bot/spam detection:
// 1) Behavioral signals (cheap, every msg): interval, repetition, length variance, link spam.
// 2) AI classifier (Lovable AI Gemini Flash Lite) sampled every Nth message OR when behavioral score > threshold.

import { classifyMessage } from "./ai.ts";
import { getSupabase, recordTrustEvent } from "./processor.ts";

type Snapshot = {
  intervals: number[]; // ms between messages
  lastTs: number;
  recent: string[]; // last N messages
};
const buf = new Map<string, Snapshot>(); // keyed by profileId

const URL_RE = /(https?:\/\/|t\.me\/|wa\.me\/|bit\.ly|tinyurl|telegram\.me)/i;
const PHONE_RE = /(?:\+?62|0)8\d{7,12}/;
const CRYPTO_RE = /\b(usdt|btc|eth|crypto|nft|airdrop|invest|profit|jackpot|slot|judi|gacor)\b/i;

export function behavioralScore(profileId: string, text: string): { score: number; reasons: string[] } {
  const now = Date.now();
  const snap = buf.get(profileId) ?? { intervals: [], lastTs: 0, recent: [] };
  if (snap.lastTs > 0) {
    const dt = now - snap.lastTs;
    snap.intervals.push(dt);
    if (snap.intervals.length > 10) snap.intervals.shift();
  }
  snap.lastTs = now;
  snap.recent.push(text.toLowerCase().slice(0, 200));
  if (snap.recent.length > 6) snap.recent.shift();
  buf.set(profileId, snap);

  let score = 0;
  const reasons: string[] = [];

  // 1) Suspicious content
  if (URL_RE.test(text)) { score += 0.4; reasons.push("link"); }
  if (PHONE_RE.test(text)) { score += 0.3; reasons.push("phone"); }
  if (CRYPTO_RE.test(text)) { score += 0.4; reasons.push("scam_keyword"); }

  // 2) Repetition (last 6 msgs) — exact duplicates ≥ 3
  const dupCount = snap.recent.filter((m) => m === text.toLowerCase().slice(0, 200)).length;
  if (dupCount >= 3) { score += 0.4; reasons.push("repetition"); }

  // 3) Burst (>= 4 msgs within 6s avg interval < 1.5s)
  if (snap.intervals.length >= 4) {
    const avg = snap.intervals.slice(-4).reduce((a, b) => a + b, 0) / 4;
    if (avg < 1500) { score += 0.3; reasons.push("burst"); }
  }

  // 4) Length monotonous (4 msgs same length ±2)
  if (snap.recent.length >= 4) {
    const lens = snap.recent.slice(-4).map((m) => m.length);
    const mn = Math.min(...lens), mx = Math.max(...lens);
    if (mx - mn <= 2 && mn > 5) { score += 0.2; reasons.push("uniform_length"); }
  }

  return { score: Math.min(1, score), reasons };
}

export function shouldRunAIClassifier(profileId: string, behavioralScore: number, msgCount: number): boolean {
  if (behavioralScore >= 0.5) return true;
  // Sample every 5th message
  if (msgCount > 0 && msgCount % 5 === 0) return true;
  return false;
}

export type DetectionResult = {
  flagged: boolean;
  banned: boolean;
  banUntil: string | null;
  reason: string;
};

// Apply detection consequences. Returns whether the offending user was sanctioned.
export async function applyDetection(
  supabase: ReturnType<typeof getSupabase>,
  profileId: string,
  conversationId: string | null,
  text: string,
  msgCount: number,
): Promise<DetectionResult> {
  const beh = behavioralScore(profileId, text);
  let aiResult: Awaited<ReturnType<typeof classifyMessage>> | null = null;

  if (shouldRunAIClassifier(profileId, beh.score, msgCount)) {
    try {
      aiResult = await classifyMessage(text);
    } catch (e) {
      console.error("classifyMessage failed", e);
    }
  }

  // Combine: AI any high-conf flag OR behavioral score high
  const aiFlagged =
    !!aiResult &&
    aiResult.confidence >= 0.7 &&
    (aiResult.is_bot || aiResult.is_spam || aiResult.is_scam || aiResult.is_nsfw);

  const flagged = aiFlagged || beh.score >= 0.7;
  const totalScore = Math.max(beh.score, aiResult?.confidence ?? 0);

  // Always log signal for audit when there's any signal
  if (flagged || beh.score >= 0.4) {
    await supabase.from("bot_signals").insert({
      profile_id: profileId,
      conversation_id: conversationId,
      signal_type: aiFlagged ? "ai_classifier" : "behavioral",
      score: totalScore,
      details: { behavioral: beh, ai: aiResult, sample: text.slice(0, 200) },
    });
  }

  if (!flagged) {
    return { flagged: false, banned: false, banUntil: null, reason: "" };
  }

  // Sanction: -10 trust, and if AI scam/nsfw with confidence >= 0.85 → 24h ban
  const severe =
    !!aiResult && aiResult.confidence >= 0.85 && (aiResult.is_scam || aiResult.is_nsfw);

  const reason =
    aiResult?.reason ??
    `Aktivitas mencurigakan terdeteksi (${beh.reasons.join(", ") || "behavioral"})`;

  await recordTrustEvent(supabase, profileId, -10, "manual", reason, conversationId);

  let banUntil: string | null = null;
  if (severe) {
    const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await supabase
      .from("profiles")
      .update({
        is_banned_until: until,
        ban_reason: `Auto-ban: ${aiResult?.reason ?? "konten berbahaya"}`,
      })
      .eq("id", profileId);
    banUntil = until;
  }

  return { flagged: true, banned: severe, banUntil, reason };
}
