// Cron-driven sweep: for any user who has been waiting in the queue > 60 seconds without
// finding a real partner, create an AI Companion conversation for them and notify both sides.
// Called every minute by pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ensureAiProfile, AI_ALIAS } from "../_shared/ai-companion.ts";
import { safeSend } from "../_shared/telegram.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const aiId = await ensureAiProfile(supabase);

    // Anyone waiting >= 60s
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: waiters, error } = await supabase
      .from("match_queue")
      .select("profile_id, joined_at")
      .eq("status", "waiting")
      .lte("joined_at", cutoff)
      .limit(20);
    if (error) throw error;
    if (!waiters || waiters.length === 0) {
      return new Response(JSON.stringify({ ok: true, matched: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let matched = 0;
    for (const w of waiters) {
      // Skip if already in active conversation (defensive)
      const { data: active } = await supabase
        .from("conversations")
        .select("id")
        .or(`user_a.eq.${w.profile_id},user_b.eq.${w.profile_id}`)
        .eq("status", "active")
        .maybeSingle();
      if (active) {
        await supabase.from("match_queue").delete().eq("profile_id", w.profile_id);
        continue;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("telegram_chat_id, alias, province_name, no_ai")
        .eq("id", w.profile_id)
        .single();
      if (!profile) continue;

      // Respect /nonai preference — skip AI matching, send transparency notice every ~5 min
      if (profile.no_ai) {
        // Only send one reminder (when they've been waiting exactly ~60s, i.e. first sweep)
        const waitSec = (Date.now() - new Date(w.joined_at).getTime()) / 1000;
        if (waitSec < 120) {
          await safeSend(
            profile.telegram_chat_id,
            `\u23f3 Belum ada user nyata yang cocok.\n` +
            `<i>Kamu sudah pilih /nonai \u2014 tetap di antrean, hanya menunggu manusia. Tidak ada AI fallback.</i>`,
          );
        }
        continue;
      }

      const { data: conv } = await supabase
        .from("conversations")
        .insert({
          user_a: w.profile_id,
          user_b: aiId,
          same_province: false,
          match_score: 0,
          status: "active",
        })
        .select("id")
        .single();
      if (!conv) continue;

      await supabase.from("match_queue").delete().eq("profile_id", w.profile_id);

      const banner =
        `\ud83e\udd16 <b>${AI_ALIAS} aktif.</b>\n` +
        `<i>Belum ada user nyata yang cocok dalam 60 detik. Kamu sedang ngobrol dengan AI Companion (transparan, bukan manusia).</i>\n\n` +
        `Ketik /stop kapan saja untuk keluar dan coba cari user nyata lagi.\n\n` +
        `Hai ${profile.alias}! \ud83d\udc4b Lagi ngapain nih hari ini?`;
      await safeSend(profile.telegram_chat_id, banner);

      await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_id: aiId,
        content: `Hai ${profile.alias}! \ud83d\udc4b Lagi ngapain nih hari ini?`,
      });

      matched++;
    }

    return new Response(JSON.stringify({ ok: true, matched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-fallback-sweep error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
