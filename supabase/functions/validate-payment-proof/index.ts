// AI Vision validator — given an image URL/base64 + expected nominal, returns extracted amount + match flag.
// Uses Lovable AI Gateway (google/gemini-2.5-flash) with vision input.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Body = {
  reference_code: string;
  image_url?: string;          // public URL or data URL
  image_base64?: string;       // raw base64 (no prefix)
  image_mime?: string;         // e.g. "image/jpeg"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "server misconfigured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: Body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!body.reference_code || (!body.image_url && !body.image_base64)) {
    return new Response(JSON.stringify({ error: "reference_code + image required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select("id, profile_id, amount_idr, status, payment_kind, reference_code")
    .eq("reference_code", body.reference_code)
    .maybeSingle();
  if (prErr || !pr) {
    return new Response(JSON.stringify({ error: "payment not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const imageContent = body.image_url
    ? { type: "image_url", image_url: { url: body.image_url } }
    : { type: "image_url", image_url: { url: `data:${body.image_mime ?? "image/jpeg"};base64,${body.image_base64}` } };

  const aiRes = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Kamu adalah validator bukti transfer QRIS Indonesia. Ekstrak nominal yang tertulis pada struk/screenshot." },
        {
          role: "user",
          content: [
            { type: "text", text: `Bukti transfer untuk referensi ${pr.reference_code}. Ekstrak nominal Rupiah yang ditransfer.` },
            imageContent,
          ],
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_payment",
          description: "Return extracted amount in IDR (integer rupiah, no decimals)",
          parameters: {
            type: "object",
            properties: {
              amount_idr: { type: "integer", description: "Nominal dalam rupiah, contoh 20000" },
              confidence: { type: "number", description: "0..1" },
              looks_valid: { type: "boolean", description: "Apakah gambar ini benar bukti transfer?" },
              note: { type: "string" },
            },
            required: ["amount_idr", "confidence", "looks_valid", "note"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "extract_payment" } },
    }),
  });

  if (!aiRes.ok) {
    const t = await aiRes.text().catch(() => "");
    if (aiRes.status === 429) return new Response(JSON.stringify({ error: "rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (aiRes.status === 402) return new Response(JSON.stringify({ error: "credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ error: "ai failed", detail: t.slice(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const aiData = await aiRes.json();
  const args = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const parsed = typeof args === "string" ? JSON.parse(args) : (args ?? {});
  const extracted = Math.max(0, Math.floor(Number(parsed.amount_idr ?? 0)));
  const expected = pr.amount_idr;
  const diff = extracted - expected;
  const matched = parsed.looks_valid && diff >= 0; // allow overpayment

  await supabase.from("payment_requests").update({
    extracted_amount_idr: extracted,
    ai_validation: {
      confidence: parsed.confidence ?? 0,
      looks_valid: !!parsed.looks_valid,
      note: parsed.note ?? "",
      matched,
      diff,
      checked_at: new Date().toISOString(),
    },
  }).eq("id", pr.id);

  return new Response(
    JSON.stringify({
      ok: true,
      reference_code: pr.reference_code,
      expected_idr: expected,
      extracted_idr: extracted,
      shortfall_idr: diff < 0 ? -diff : 0,
      matched,
      auto_approve_eligible: matched && (parsed.confidence ?? 0) >= 0.85,
      note: parsed.note ?? "",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
