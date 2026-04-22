-- =========================================================
-- SECURITY HARDENING — Fix all audit errors & warnings
-- =========================================================

-- ===== 1. REVOKE admin/internal RPCs from public access =====
-- These should only be callable by service_role (Edge Functions)

REVOKE EXECUTE ON FUNCTION public.approve_premium_payment(TEXT, INT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_premium_payment(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_bot_signal(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_or_create_profile_by_telegram_id(BIGINT, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_trust_event(UUID, INT, TEXT, TEXT, UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_trust_score_change(UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_premium_upgrade(UUID, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_old_messages() FROM PUBLIC;

-- Grant back to service_role (used by Edge Functions)
GRANT EXECUTE ON FUNCTION public.approve_premium_payment(TEXT, INT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_premium_payment(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_bot_signal(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_or_create_profile_by_telegram_id(BIGINT, BIGINT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_trust_event(UUID, INT, TEXT, TEXT, UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_trust_score_change(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_premium_upgrade(UUID, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_messages() TO service_role;

-- Keep has_role, is_admin, current_profile_id callable by authenticated (used in RLS)

-- ===== 2. Defense-in-depth: add admin checks inside admin RPCs =====

CREATE OR REPLACE FUNCTION public.approve_premium_payment(
  _reference_code TEXT,
  _days INT DEFAULT 30,
  _admin_id UUID DEFAULT NULL,
  _admin_note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pr RECORD;
BEGIN
  -- Block non-admin authenticated callers (service_role bypasses this)
  IF current_setting('role', true) = 'authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO pr FROM public.payment_requests WHERE reference_code = _reference_code;
  IF pr IS NULL THEN RETURN FALSE; END IF;
  IF pr.status <> 'pending' THEN RETURN FALSE; END IF;

  UPDATE public.payment_requests
  SET status = 'approved',
      reviewed_by = _admin_id,
      reviewed_at = now(),
      admin_note = COALESCE(_admin_note, admin_note),
      updated_at = now()
  WHERE id = pr.id;

  UPDATE public.profiles
  SET is_premium = TRUE,
      premium_until = GREATEST(COALESCE(premium_until, now()), now()) + (_days || ' days')::INTERVAL,
      is_banned_until = NULL,
      ban_reason = NULL,
      updated_at = now()
  WHERE id = pr.profile_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_premium_payment(
  _reference_code TEXT,
  _admin_id UUID DEFAULT NULL,
  _admin_note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pr RECORD;
BEGIN
  IF current_setting('role', true) = 'authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO pr FROM public.payment_requests WHERE reference_code = _reference_code;
  IF pr IS NULL THEN RETURN FALSE; END IF;
  IF pr.status <> 'pending' THEN RETURN FALSE; END IF;

  UPDATE public.payment_requests
  SET status = 'rejected',
      reviewed_by = _admin_id,
      reviewed_at = now(),
      admin_note = COALESCE(_admin_note, admin_note),
      updated_at = now()
  WHERE id = pr.id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_bot_signal(
  _signal_id UUID,
  _admin_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sig RECORD;
  new_score INT;
BEGIN
  IF current_setting('role', true) = 'authenticated' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO sig FROM public.bot_signals WHERE id = _signal_id;
  IF sig IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.profiles
  SET trust_score    = LEAST(150, trust_score + 10),
      is_banned_until = NULL,
      ban_reason      = NULL,
      updated_at      = now()
  WHERE id = sig.profile_id
  RETURNING trust_score INTO new_score;

  INSERT INTO public.trust_events (
    profile_id, event_type, delta, new_score, reason
  ) VALUES (
    sig.profile_id, 'manual', 10, new_score,
    'Salah deteksi dibatalkan admin (signal id=' || _signal_id || ')'
  );

  UPDATE public.bot_signals
  SET details = jsonb_set(
    jsonb_set(
      COALESCE(details, '{}'::jsonb),
      '{cancelled}', to_jsonb(true)
    ),
    '{cancelled_by}', to_jsonb(_admin_id::text)
  )
  WHERE id = _signal_id;

  RETURN TRUE;
END;
$$;

-- ===== 3. Fix profile RLS: restrict SELECT to own profile =====

DROP POLICY IF EXISTS "Anyone authenticated can view profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = public.current_profile_id() OR public.is_admin());

-- ===== 4. Fix user_interests RLS: restrict to own =====

DROP POLICY IF EXISTS "Anyone authenticated can view interests" ON public.user_interests;

CREATE POLICY "Users can view own interests"
  ON public.user_interests FOR SELECT
  TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin());

-- ===== 5. Protect admin-controlled fields on profile updates =====

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = public.current_profile_id() OR public.is_admin())
  WITH CHECK (id = public.current_profile_id() OR public.is_admin());

-- Trigger to prevent non-admin users from modifying sensitive fields
CREATE OR REPLACE FUNCTION public.protect_admin_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enforce restrictions for authenticated role (not service_role/postgres)
  IF current_setting('role', true) = 'authenticated' AND NOT public.is_admin() THEN
    NEW.trust_score       := OLD.trust_score;
    NEW.is_premium        := OLD.is_premium;
    NEW.premium_until     := OLD.premium_until;
    NEW.is_banned_until   := OLD.is_banned_until;
    NEW.ban_reason        := OLD.ban_reason;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_admin_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_admin_fields();

-- ===== 6. Restrict Realtime: remove sensitive tables from publication =====

ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.profiles;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.match_queue;
-- Keep messages and conversations (protected by participant-only RLS)

-- ===== 7. Webhook security note =====
-- The telegram-webhook function has verify_jwt=false (required for Telegram POST).
-- It is secured by TELEGRAM_WEBHOOK_SECRET header verification in code.
-- Admin commands (/admin) have application-level isAdmin() checks in processor.ts.
-- No additional DB migration needed — this is handled at the Edge Function layer.

-- ===== 8. JWT claim note =====
-- current_profile_id() relies on JWT claim 'telegram_user_id'.
-- Supabase signs JWTs with JWT_SECRET — claims cannot be forged
-- unless the secret is leaked. This is acceptable for the current
-- Telegram-bot-first architecture where web auth is admin-only.
