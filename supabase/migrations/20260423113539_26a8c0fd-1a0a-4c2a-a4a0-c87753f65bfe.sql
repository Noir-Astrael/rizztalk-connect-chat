
-- =========================================================
-- 1. Add missing columns to profiles (used by edge processor)
-- =========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_step text,
  ADD COLUMN IF NOT EXISTS pending_payment_ref text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id ON public.profiles(auth_user_id);

-- =========================================================
-- 2. Auth-aware admin check (works for Supabase Auth users via auth.uid)
--    Keep is_admin() name; redefine to support BOTH telegram-jwt path AND supabase auth.uid
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.profile_id
    WHERE ur.role = 'admin'
      AND (
        -- supabase-auth user (web admin dashboard)
        (auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid())
        OR
        -- telegram-jwt user (bot admin commands)
        p.id = public.current_profile_id()
      )
  );
$$;

-- =========================================================
-- 3. Admin dashboard RPCs (SECURITY DEFINER + admin gate)
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'access denied: admin only';
  END IF;

  SELECT jsonb_build_object(
    'total_users',         (SELECT count(*) FROM public.profiles WHERE telegram_user_id <> -777000777),
    'premium_users',       (SELECT count(*) FROM public.profiles WHERE is_premium = true),
    'banned_users',        (SELECT count(*) FROM public.profiles WHERE is_banned_until IS NOT NULL AND is_banned_until > now()),
    'active_chats',        (SELECT count(*) FROM public.conversations WHERE status = 'active'),
    'total_conversations', (SELECT count(*) FROM public.conversations),
    'pending_payments',    (SELECT count(*) FROM public.payment_requests WHERE status = 'pending'),
    'approved_payments',   (SELECT count(*) FROM public.payment_requests WHERE status = 'approved'),
    'rejected_payments',   (SELECT count(*) FROM public.payment_requests WHERE status = 'rejected'),
    'reports_24h',         (SELECT count(*) FROM public.user_reports WHERE created_at > now() - interval '24 hours'),
    'bot_signals_24h',     (SELECT count(*) FROM public.bot_signals WHERE created_at > now() - interval '24 hours'),
    'queue_waiting',       (SELECT count(*) FROM public.match_queue WHERE status = 'waiting')
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_conversations(_days int DEFAULT 30)
RETURNS TABLE(day text, count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'access denied: admin only';
  END IF;
  RETURN QUERY
  SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
         COALESCE(count(c.id), 0)::bigint AS count
  FROM generate_series(now()::date - (_days - 1), now()::date, interval '1 day') AS d
  LEFT JOIN public.conversations c
    ON date_trunc('day', c.started_at) = d
  GROUP BY d
  ORDER BY d;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_signups(_days int DEFAULT 30)
RETURNS TABLE(day text, count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'access denied: admin only';
  END IF;
  RETURN QUERY
  SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
         COALESCE(count(p.id), 0)::bigint AS count
  FROM generate_series(now()::date - (_days - 1), now()::date, interval '1 day') AS d
  LEFT JOIN public.profiles p
    ON date_trunc('day', p.created_at) = d
   AND p.telegram_user_id <> -777000777
  GROUP BY d
  ORDER BY d;
END;
$$;

-- =========================================================
-- 4. Helper: link an authenticated user to an admin profile
--    Call from SQL when creating new admins. Idempotent.
-- =========================================================
CREATE OR REPLACE FUNCTION public.link_admin_auth_user(_auth_user_id uuid, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  fake_tg_id bigint;
BEGIN
  -- already linked?
  SELECT id INTO pid FROM public.profiles WHERE auth_user_id = _auth_user_id;
  IF pid IS NOT NULL THEN
    INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'admin')
      ON CONFLICT (profile_id, role) DO NOTHING;
    RETURN pid;
  END IF;

  -- create a profile for this admin (negative tg id to avoid collisions)
  fake_tg_id := -1000000 - (extract(epoch from now())::bigint % 1000000);
  INSERT INTO public.profiles (
    telegram_user_id, telegram_chat_id, alias, auth_user_id,
    onboarding_completed, gender, gender_preference, trust_score
  ) VALUES (
    fake_tg_id, fake_tg_id, 'Admin (' || _email || ')', _auth_user_id,
    true, 'other', 'any', 150
  )
  RETURNING id INTO pid;

  INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'admin')
    ON CONFLICT (profile_id, role) DO NOTHING;

  RETURN pid;
END;
$$;

-- Make sure user_roles has the unique constraint expected by ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_profile_id_role_key'
  ) THEN
    BEGIN
      ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_profile_id_role_key UNIQUE (profile_id, role);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END;
  END IF;
END$$;
