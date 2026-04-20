// Rizztalk Telegram Bot — cron polling fallback. Pulls getUpdates and delegates to shared processor.
import { getUpdates } from "../_shared/telegram.ts";
import { processUpdate, getSupabase, type TgUpdate } from "../_shared/processor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  const supabase = getSupabase();
  let totalProcessed = 0;

  try {
    const { data: state, error: stateErr } = await supabase
      .from("telegram_bot_state")
      .select("update_offset")
      .eq("id", 1)
      .single();
    if (stateErr) throw stateErr;
    let currentOffset: number = state.update_offset;

    while (true) {
      const elapsed = Date.now() - startTime;
      const remainingMs = MAX_RUNTIME_MS - elapsed;
      if (remainingMs < MIN_REMAINING_MS) break;
      const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
      if (timeout < 1) break;

      let data: { result?: TgUpdate[] };
      try {
        data = await getUpdates(currentOffset, timeout);
      } catch (e) {
        console.error("getUpdates failed:", e);
        break;
      }
      const updates = data.result ?? [];
      if (updates.length === 0) continue;

      for (const u of updates) {
        try {
          await processUpdate(supabase, u);
          totalProcessed++;
        } catch (e) {
          console.error(`processUpdate ${u.update_id} failed:`, e);
        }
      }

      const newOffset = Math.max(...updates.map(u => u.update_id)) + 1;
      await supabase
        .from("telegram_bot_state")
        .update({ update_offset: newOffset, last_polled_at: new Date().toISOString() })
        .eq("id", 1);
      currentOffset = newOffset;
    }

    return new Response(JSON.stringify({ ok: true, processed: totalProcessed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("telegram-poll fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
