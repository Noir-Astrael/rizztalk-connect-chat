// Public healthcheck — verifies DB, Telegram bot, and edge runtime status.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const checks: Record<string, { ok: boolean; ms?: number; detail?: string }> = {};

  // DB
  try {
    const t0 = Date.now();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).limit(1);
    checks.database = { ok: !error, ms: Date.now() - t0, detail: error?.message };
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // Telegram (lightweight getMe via gateway)
  try {
    const t0 = Date.now();
    const r = await fetch("https://connector-gateway.lovable.dev/telegram/getMe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
        "X-Connection-Api-Key": Deno.env.get("TELEGRAM_API_KEY") ?? "",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    checks.telegram = { ok: r.ok, ms: Date.now() - t0, detail: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e) {
    checks.telegram = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // AI Gateway env
  checks.ai_gateway = { ok: !!Deno.env.get("LOVABLE_API_KEY") };

  const allOk = Object.values(checks).every((c) => c.ok);
  return new Response(
    JSON.stringify({ ok: allOk, ts: new Date().toISOString(), elapsed_ms: Date.now() - startedAt, checks }, null, 2),
    { status: allOk ? 200 : 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
