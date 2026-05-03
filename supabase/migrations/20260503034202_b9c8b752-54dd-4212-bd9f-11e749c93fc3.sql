-- Add storage path column for proof images uploaded to Supabase Storage
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS proof_image_storage_path text;

-- Generate a signed URL (5 min) for an admin/owner to view a payment proof.
CREATE OR REPLACE FUNCTION public.get_payment_proof_url(_reference_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pr public.payment_requests%ROWTYPE;
  signed jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO pr FROM public.payment_requests WHERE reference_code = _reference_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF pr.proof_image_storage_path IS NULL THEN
    -- Fall back to file_id (Telegram-only) — admin must view via bot.
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'no_storage_image',
      'telegram_file_id', pr.proof_image_file_id
    );
  END IF;

  -- Generate signed URL via storage extension
  SELECT storage.create_signed_url('payment-proofs', pr.proof_image_storage_path, 300) INTO signed;
  RETURN jsonb_build_object('ok', true, 'signed_url', signed);
EXCEPTION WHEN OTHERS THEN
  -- Fallback: build signed URL using public storage API path (admin will use anon-signed RPC)
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_proof_url(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_proof_url(text) TO authenticated;

-- Owner-only: revoke premium from a user (if proof was fake or fraud detected)
CREATE OR REPLACE FUNCTION public.revoke_premium(_profile_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_profile uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_only');
  END IF;

  SELECT id INTO caller_profile FROM public.profiles WHERE auth_user_id = auth.uid();

  UPDATE public.profiles
  SET is_premium = false,
      premium_until = NULL,
      gender_preference = 'any',
      monthly_unban_credit_used = false,
      updated_at = now()
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;

  INSERT INTO public.audit_log (actor_profile_id, action, target_profile_id, details)
  VALUES (
    caller_profile,
    'revoke_premium',
    _profile_id,
    jsonb_build_object('reason', COALESCE(_reason, 'fake_proof'))
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_premium(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_premium(uuid, text) TO authenticated;