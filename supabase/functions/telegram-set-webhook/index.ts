// One-shot helper to register the Telegram webhook URL with the bot.
// Call this manually after deploy: curl -X POST .../telegram-set-webhook
// To remove: POST with {"action":"delete"}

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY || !SUPABASE_URL) {
    return new Response(JSON.stringify({ error: "Missing env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const action = body.action ?? "set";
  const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-webhook`;

  const path = action === "delete" ? "/deleteWebhook" : "/setWebhook";
  const payload: Record<string, unknown> = action === "delete"
    ? { drop_pending_updates: true }
    : {
        url: webhookUrl,
        allowed_updates: ["message"],
        drop_pending_updates: true,
        ...(SECRET ? { secret_token: SECRET } : {}),
      };

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  // Also fetch info for visibility
  const infoRes = await fetch(`${GATEWAY_URL}/getWebhookInfo`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const info = await infoRes.json();

  return new Response(JSON.stringify({ action, webhookUrl, result: data, info }, null, 2), {
    status: res.ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
