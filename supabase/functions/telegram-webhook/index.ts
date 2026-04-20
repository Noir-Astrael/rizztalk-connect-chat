// Rizztalk Telegram Webhook — INSTANT response handler
// Telegram POSTs each update directly to this endpoint (no polling delay).
// Secured via X-Telegram-Bot-Api-Secret-Token header.

import { processUpdate, getSupabase } from "../telegram-poll/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify Telegram secret token (set when registering webhook)
  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (expectedSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expectedSecret) {
      console.warn("Webhook unauthorized: secret mismatch");
      return new Response("forbidden", { status: 403, headers: corsHeaders });
    }
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400, headers: corsHeaders });
  }

  // ACK Telegram quickly, process in background (non-blocking)
  const supabase = getSupabase();
  // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
  const bg = (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil)
    // @ts-ignore
    ? EdgeRuntime.waitUntil
    : (p: Promise<unknown>) => p;

  bg(
    (async () => {
      try {
        await processUpdate(supabase, update);
      } catch (e) {
        console.error("webhook processUpdate failed:", e);
      }
    })(),
  );

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
