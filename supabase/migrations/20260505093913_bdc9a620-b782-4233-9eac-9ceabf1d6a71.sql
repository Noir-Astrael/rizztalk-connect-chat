-- 1. audit_log table (root cause: revoke_premium gagal karena tabel ini belum ada)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid,
  action text NOT NULL,
  target_profile_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.audit_log(target_profile_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_profile_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit log"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert audit log"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- 2. Revoke premium berdasarkan reference_code (untuk command /cabut di Telegram).
--    Owner ATAU admin boleh menjalankan. Caller bisa berupa profile Telegram (tanpa auth.uid).
CREATE OR REPLACE FUNCTION public.revoke_premium_by_reference(
  _reference_code text,
  _actor_profile_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pr RECORD;
  is_authorized boolean;
BEGIN
  -- authorize: actor harus admin atau owner
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE profile_id = _actor_profile_id
      AND role IN ('admin'::app_role, 'owner'::app_role)
  ) INTO is_authorized;

  IF NOT is_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO pr FROM public.payment_requests WHERE reference_code = _reference_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reference_not_found');
  END IF;

  UPDATE public.profiles
  SET is_premium = false,
      premium_until = NULL,
      gender_preference = 'any',
      monthly_unban_credit_used = false,
      updated_at = now()
  WHERE id = pr.profile_id;

  -- mark payment as rejected/revoked agar tidak ambigu
  UPDATE public.payment_requests
  SET status = 'rejected',
      reviewed_by = _actor_profile_id,
      reviewed_at = now(),
      admin_note = COALESCE(admin_note, '') || ' [revoked: ' || COALESCE(_reason, 'fake_proof') || ']',
      updated_at = now()
  WHERE id = pr.id;

  INSERT INTO public.audit_log (actor_profile_id, action, target_profile_id, details)
  VALUES (
    _actor_profile_id,
    'revoke_premium_by_ref',
    pr.profile_id,
    jsonb_build_object(
      'reference_code', _reference_code,
      'reason', COALESCE(_reason, 'fake_proof')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', pr.profile_id,
    'reference_code', _reference_code
  );
END;
$$;

-- 3. Unban user manual via Telegram ID atau username (admin/owner only).
CREATE OR REPLACE FUNCTION public.admin_unban_user(
  _actor_profile_id uuid,
  _telegram_user_id bigint DEFAULT NULL,
  _telegram_username text DEFAULT NULL,
  _reason text DEFAULT 'Admin manual unban'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target RECORD;
  is_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE profile_id = _actor_profile_id
      AND role IN ('admin'::app_role, 'owner'::app_role)
  ) INTO is_authorized;

  IF NOT is_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF _telegram_user_id IS NOT NULL THEN
    SELECT id, telegram_chat_id, alias INTO target
    FROM public.profiles
    WHERE telegram_user_id = _telegram_user_id
    LIMIT 1;
  ELSIF _telegram_username IS NOT NULL THEN
    SELECT id, telegram_chat_id, alias INTO target
    FROM public.profiles
    WHERE LOWER(telegram_username) = LOWER(REPLACE(_telegram_username, '@', ''))
    LIMIT 1;
  END IF;

  IF target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  UPDATE public.profiles
  SET is_banned_until = NULL,
      ban_reason = NULL,
      ban_severity = NULL,
      trust_score = GREATEST(trust_score, 80),
      updated_at = now()
  WHERE id = target.id;

  -- Restore trust event so audit trail jelas
  INSERT INTO public.trust_events (profile_id, event_type, delta, new_score, reason)
  SELECT target.id, 'manual', 0, p.trust_score,
    'Manual unban oleh admin (' || COALESCE(_reason, 'no reason') || ')'
  FROM public.profiles p WHERE p.id = target.id;

  INSERT INTO public.audit_log (actor_profile_id, action, target_profile_id, details)
  VALUES (
    _actor_profile_id,
    'admin_unban_user',
    target.id,
    jsonb_build_object('reason', COALESCE(_reason, 'no reason'))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', target.id,
    'telegram_chat_id', target.telegram_chat_id,
    'alias', target.alias
  );
END;
$$;

-- 4. Promote @Rizz_Admins jadi owner + admin
DO $$
DECLARE pid uuid;
BEGIN
  SELECT id INTO pid FROM public.profiles
  WHERE LOWER(telegram_username) = LOWER('Rizz_Admins')
  LIMIT 1;

  IF pid IS NOT NULL THEN
    INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'admin'::app_role)
      ON CONFLICT (profile_id, role) DO NOTHING;
    INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'owner'::app_role)
      ON CONFLICT (profile_id, role) DO NOTHING;
  END IF;
END $$;

-- 5. Helper untuk mendapatkan list owner Telegram chat IDs (untuk forward bukti).
CREATE OR REPLACE FUNCTION public.get_owner_notify_chats()
RETURNS TABLE(profile_id uuid, telegram_chat_id bigint, telegram_username text, alias text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.telegram_chat_id, p.telegram_username, p.alias
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.profile_id = p.id
  WHERE ur.role = 'owner'::app_role
    AND p.telegram_user_id > 0  -- only real Telegram users (skip web-only owner)
    AND p.telegram_chat_id IS NOT NULL;
$$;