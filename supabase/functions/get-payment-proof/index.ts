// Returns a short-lived signed URL for an admin/owner to view a payment proof image.
// Uploaded by the bot to the `payment-proofs` bucket. Caller must be admin/owner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify caller is admin/owner via authed client
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isAdminData, error: isAdminErr } = await userClient.rpc("is_admin");
  if (isAdminErr || !isAdminData) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { reference_code?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const ref = body.reference_code?.trim();
  if (!ref) {
    return new Response(JSON.stringify({ error: "reference_code required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: pr } = await admin
    .from("payment_requests")
    .select("proof_image_storage_path, proof_image_file_id")
    .eq("reference_code", ref)
    .maybeSingle();

  if (!pr || !pr.proof_image_storage_path) {
    return new Response(JSON.stringify({
      error: "no_image",
      telegram_file_id: pr?.proof_image_file_id ?? null,
    }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: signed, error: signedErr } = await admin
    .storage
    .from("payment-proofs")
    .createSignedUrl(pr.proof_image_storage_path, 300);

  if (signedErr || !signed) {
    return new Response(JSON.stringify({ error: signedErr?.message ?? "sign_failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, signed_url: signed.signedUrl }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
