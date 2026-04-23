-- =========================================================
-- PRODUCTION HARDENING — Admin Dashboard & Security
-- 2026-04-23
-- =========================================================

-- ===== 1. Persist onboarding step to DB (replaces in-memory Map) =====
-- Prevents loss of wizard state when Edge Function cold-starts

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_step TEXT
    CHECK (onboarding_step IS NULL OR onboarding_step IN (
      'idle', 'set_alias', 'set_gender', 'set_province',
      'set_interests', 'set_bio', 'set_gender_pref', 'await_payment_proof'
    )) DEFAULT NULL;

-- For await_payment_proof we also need to store the reference code
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_payment_ref TEXT DEFAULT NULL;

-- ===== 2. Admin dashboard helper functions =====

-- Returns aggregated statistics for the admin dashboard
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  SELECT jsonb_build_object(
    'total_users',        (SELECT COUNT(*) FROM public.profiles WHERE telegram_user_id > 0),
    'premium_users',      (SELECT COUNT(*) FROM public.profiles WHERE is_premium = true AND premium_until > now()),
    'banned_users',       (SELECT COUNT(*) FROM public.profiles WHERE is_banned_until IS NOT NULL AND is_banned_until > now()),
    'active_chats',       (SELECT COUNT(*) FROM public.conversations WHERE status = 'active'),
    'total_conversations',(SELECT COUNT(*) FROM public.conversations),
    'pending_payments',   (SELECT COUNT(*) FROM public.payment_requests WHERE status = 'pending'),
    'approved_payments',  (SELECT COUNT(*) FROM public.payment_requests WHERE status = 'approved'),
    'rejected_payments',  (SELECT COUNT(*) FROM public.payment_requests WHERE status = 'rejected'),
    'reports_24h',        (SELECT COUNT(*) FROM public.user_reports WHERE created_at > now() - INTERVAL '24 hours'),
    'bot_signals_24h',    (SELECT COUNT(*) FROM public.bot_signals WHERE created_at > now() - INTERVAL '24 hours'),
    'queue_waiting',      (SELECT COUNT(*) FROM public.match_queue WHERE status = 'waiting')
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;

-- Returns daily conversation counts for the last N days
CREATE OR REPLACE FUNCTION public.admin_daily_conversations(_days INT DEFAULT 30)
RETURNS TABLE (day DATE, count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    DATE(started_at) AS day,
    COUNT(*)         AS count
  FROM public.conversations
  WHERE started_at >= now() - (_days || ' days')::INTERVAL
    AND public.is_admin()
  GROUP BY DATE(started_at)
  ORDER BY day ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_daily_conversations(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_daily_conversations(INT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_daily_conversations(INT) TO service_role;

-- Returns daily new user registrations
CREATE OR REPLACE FUNCTION public.admin_daily_signups(_days INT DEFAULT 30)
RETURNS TABLE (day DATE, count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    DATE(created_at) AS day,
    COUNT(*)         AS count
  FROM public.profiles
  WHERE created_at >= now() - (_days || ' days')::INTERVAL
    AND telegram_user_id > 0
    AND public.is_admin()
  GROUP BY DATE(created_at)
  ORDER BY day ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_daily_signups(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_daily_signups(INT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_daily_signups(INT) TO service_role;

-- ===== 3. Admin-only RLS for new columns =====

-- The onboarding_step and pending_payment_ref should only be updated
-- by service_role (Edge Functions). Users should NOT be able to manipulate these.
-- The protect_admin_fields trigger added in security_hardening migration handles this.

-- ===== 4. Additional indexes for dashboard queries =====

CREATE INDEX IF NOT EXISTS idx_conversations_started_at
  ON public.conversations (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON public.profiles (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_premium
  ON public.profiles (is_premium, premium_until)
  WHERE is_premium = true;

CREATE INDEX IF NOT EXISTS idx_profiles_banned
  ON public.profiles (is_banned_until)
  WHERE is_banned_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_requests_status_created
  ON public.payment_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_reports_created
  ON public.user_reports (created_at DESC);

-- ===== 5. Admin account bootstrap instruction =====
-- After deploying, create an admin account via:
-- 1. Supabase Dashboard > Authentication > Users > Create User (email + password)
-- 2. Run this query (replace <auth_user_email> and <telegram_user_id>):
--
--   INSERT INTO public.user_roles (profile_id, role)
--   SELECT id, 'admin'
--   FROM public.profiles
--   WHERE telegram_user_id = <telegram_user_id_of_admin>
--   ON CONFLICT (profile_id, role) DO NOTHING;
--
-- Or for web-only admin (without Telegram):
--   -- First insert a synthetic profile for the admin's auth user
--   -- then assign role = 'admin'
