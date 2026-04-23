-- is_owner() FIRST (before any policy uses it)
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.profile_id
    WHERE ur.role = 'owner'::app_role
      AND (
        (auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid())
        OR p.id = public.current_profile_id()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.profile_id
    WHERE ur.role IN ('admin'::app_role, 'owner'::app_role)
      AND (
        (auth.uid() IS NOT NULL AND p.auth_user_id = auth.uid())
        OR p.id = public.current_profile_id()
      )
  );
$$;

-- Profile columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ban_severity text CHECK (ban_severity IN ('light','medium','severe')),
  ADD COLUMN IF NOT EXISTS monthly_unban_credit_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_unban_credit_reset_at timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month');

-- payment_requests columns
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS payment_kind text NOT NULL DEFAULT 'premium' CHECK (payment_kind IN ('premium','unban')),
  ADD COLUMN IF NOT EXISTS target_severity text CHECK (target_severity IN ('light','medium','severe')),
  ADD COLUMN IF NOT EXISTS ai_validation jsonb,
  ADD COLUMN IF NOT EXISTS proof_image_file_id text,
  ADD COLUMN IF NOT EXISTS proof_image_url text,
  ADD COLUMN IF NOT EXISTS extracted_amount_idr integer;

-- webhook_logs
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event text NOT NULL,
  status_code integer,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error','critical')),
  message text,
  payload jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON public.webhook_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_level ON public.webhook_logs (level, created_at DESC);
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage webhook_logs" ON public.webhook_logs;
CREATE POLICY "Admins manage webhook_logs" ON public.webhook_logs
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- admin_credentials (metadata only, no plaintext)
CREATE TABLE IF NOT EXISTS public.admin_credentials (
  profile_id uuid PRIMARY KEY,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  password_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  force_rotate boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view credentials meta" ON public.admin_credentials;
CREATE POLICY "Admins view credentials meta" ON public.admin_credentials
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Owners manage credentials" ON public.admin_credentials;
CREATE POLICY "Owners manage credentials" ON public.admin_credentials
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Updated handle_new_report (sets ban_severity)
CREATE OR REPLACE FUNCTION public.handle_new_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_count INT;
BEGIN
  UPDATE public.profiles
  SET trust_score = GREATEST(0, trust_score - 5),
      updated_at = now()
  WHERE id = NEW.reported_id;

  SELECT COUNT(*) INTO recent_count
  FROM public.user_reports
  WHERE reported_id = NEW.reported_id
    AND created_at > now() - INTERVAL '24 hours';

  IF recent_count >= 5 THEN
    UPDATE public.profiles
    SET is_banned_until = now() + INTERVAL '24 hours',
        ban_reason = 'Auto-ban: ' || recent_count || ' report dalam 24 jam',
        ban_severity = CASE
          WHEN recent_count >= 10 THEN 'severe'
          WHEN recent_count >= 7 THEN 'medium'
          ELSE 'light'
        END,
        updated_at = now()
    WHERE id = NEW.reported_id
      AND (is_banned_until IS NULL OR is_banned_until < now() + INTERVAL '24 hours');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_reports_after_insert ON public.user_reports;
CREATE TRIGGER user_reports_after_insert
  AFTER INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_report();

-- link_owner_auth_user
CREATE OR REPLACE FUNCTION public.link_owner_auth_user(_auth_user_id uuid, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pid uuid;
  fake_tg_id bigint;
BEGIN
  SELECT id INTO pid FROM public.profiles WHERE auth_user_id = _auth_user_id;
  IF pid IS NOT NULL THEN
    INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'owner'::app_role)
      ON CONFLICT (profile_id, role) DO NOTHING;
    INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'admin'::app_role)
      ON CONFLICT (profile_id, role) DO NOTHING;
    INSERT INTO public.admin_credentials (profile_id) VALUES (pid)
      ON CONFLICT (profile_id) DO UPDATE SET
        password_changed_at = now(),
        password_expires_at = now() + interval '90 days',
        force_rotate = false;
    RETURN pid;
  END IF;

  fake_tg_id := -2000000 - (extract(epoch from now())::bigint % 1000000);
  INSERT INTO public.profiles (
    telegram_user_id, telegram_chat_id, alias, auth_user_id,
    onboarding_completed, gender, gender_preference, trust_score
  ) VALUES (
    fake_tg_id, fake_tg_id, 'Owner (' || _email || ')', _auth_user_id,
    true, 'other', 'any', 150
  )
  RETURNING id INTO pid;

  INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'owner'::app_role)
    ON CONFLICT (profile_id, role) DO NOTHING;
  INSERT INTO public.user_roles(profile_id, role) VALUES (pid, 'admin'::app_role)
    ON CONFLICT (profile_id, role) DO NOTHING;
  INSERT INTO public.admin_credentials (profile_id) VALUES (pid)
    ON CONFLICT (profile_id) DO NOTHING;
  RETURN pid;
END;
$$;

-- Admin management RPCs
CREATE OR REPLACE FUNCTION public.add_admin_role(_target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_auth uuid;
  target_pid uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'access denied: owner only';
  END IF;
  SELECT id INTO target_auth FROM auth.users WHERE email = _target_email LIMIT 1;
  IF target_auth IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auth user not found — user must sign up first');
  END IF;
  SELECT id INTO target_pid FROM public.profiles WHERE auth_user_id = target_auth;
  IF target_pid IS NULL THEN
    target_pid := public.link_admin_auth_user(target_auth, _target_email);
  ELSE
    INSERT INTO public.user_roles(profile_id, role) VALUES (target_pid, 'admin'::app_role)
      ON CONFLICT (profile_id, role) DO NOTHING;
    INSERT INTO public.admin_credentials (profile_id) VALUES (target_pid)
      ON CONFLICT (profile_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'profile_id', target_pid);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_admin_role(_target_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_auth uuid;
  target_pid uuid;
  is_target_owner boolean;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'access denied: owner only';
  END IF;
  SELECT id INTO target_auth FROM auth.users WHERE email = _target_email LIMIT 1;
  IF target_auth IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auth user not found');
  END IF;
  SELECT id INTO target_pid FROM public.profiles WHERE auth_user_id = target_auth;
  IF target_pid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile not found');
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE profile_id = target_pid AND role = 'owner'::app_role)
    INTO is_target_owner;
  IF is_target_owner THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot remove owner');
  END IF;
  DELETE FROM public.user_roles WHERE profile_id = target_pid AND role = 'admin'::app_role;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE(profile_id uuid, email text, alias text, last_login_at timestamptz, password_changed_at timestamptz, password_expires_at timestamptz, is_owner boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'access denied: admin only';
  END IF;
  RETURN QUERY
  SELECT p.id,
         u.email::text,
         p.alias,
         ac.last_login_at,
         ac.password_changed_at,
         ac.password_expires_at,
         EXISTS(SELECT 1 FROM public.user_roles ur2 WHERE ur2.profile_id = p.id AND ur2.role = 'owner'::app_role) AS is_owner
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.profile_id = p.id AND ur.role IN ('admin'::app_role,'owner'::app_role)
  LEFT JOIN auth.users u ON u.id = p.auth_user_id
  LEFT JOIN public.admin_credentials ac ON ac.profile_id = p.id
  GROUP BY p.id, u.email, ac.last_login_at, ac.password_changed_at, ac.password_expires_at;
END;
$$;

-- Unban payment RPCs
CREATE OR REPLACE FUNCTION public.request_unban(_profile_id uuid, _severity text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ref_code text;
  amount integer;
BEGIN
  IF _severity NOT IN ('light','medium','severe') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid severity');
  END IF;
  amount := CASE _severity
    WHEN 'severe' THEN 15000
    WHEN 'medium' THEN 10000
    ELSE 5000
  END;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile not found');
  END IF;

  UPDATE public.payment_requests
    SET status = 'rejected', admin_note = COALESCE(admin_note,'') || ' [auto-cancelled: superseded]', updated_at = now()
    WHERE profile_id = _profile_id AND payment_kind = 'unban' AND status = 'pending';

  ref_code := 'UNB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  INSERT INTO public.payment_requests (
    profile_id, plan, amount_idr, reference_code, payment_kind, target_severity
  ) VALUES (
    _profile_id, _severity || '_unban', amount, ref_code, 'unban', _severity
  );

  RETURN jsonb_build_object('ok', true, 'reference_code', ref_code, 'amount_idr', amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_unban_payment(
  _reference_code text, _admin_id uuid DEFAULT NULL, _admin_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE pr RECORD;
BEGIN
  SELECT * INTO pr FROM public.payment_requests
    WHERE reference_code = _reference_code AND payment_kind = 'unban';
  IF pr IS NULL OR pr.status <> 'pending' THEN RETURN FALSE; END IF;

  UPDATE public.payment_requests
    SET status = 'approved', reviewed_by = _admin_id, reviewed_at = now(),
        admin_note = COALESCE(_admin_note, admin_note), updated_at = now()
    WHERE id = pr.id;

  UPDATE public.profiles
    SET is_banned_until = NULL, ban_reason = NULL, ban_severity = NULL, updated_at = now()
    WHERE id = pr.profile_id;

  INSERT INTO public.trust_events (profile_id, event_type, delta, new_score, reason)
  SELECT pr.profile_id, 'manual', 0, trust_score,
         'Unban berbayar disetujui (' || pr.target_severity || ', ref ' || _reference_code || ')'
  FROM public.profiles WHERE id = pr.profile_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_unban_payment(
  _reference_code text, _admin_id uuid DEFAULT NULL, _admin_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE pr RECORD;
BEGIN
  SELECT * INTO pr FROM public.payment_requests
    WHERE reference_code = _reference_code AND payment_kind = 'unban';
  IF pr IS NULL OR pr.status <> 'pending' THEN RETURN FALSE; END IF;
  UPDATE public.payment_requests
    SET status = 'rejected', reviewed_by = _admin_id, reviewed_at = now(),
        admin_note = COALESCE(_admin_note, admin_note), updated_at = now()
    WHERE id = pr.id;
  RETURN TRUE;
END;
$$;

-- Owner monitoring RPCs
CREATE OR REPLACE FUNCTION public.owner_active_sessions()
RETURNS TABLE(
  conversation_id uuid, started_at timestamptz,
  user_a_alias text, user_a_tg bigint,
  user_b_alias text, user_b_tg bigint,
  message_count bigint, last_message_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'access denied: owner only';
  END IF;
  RETURN QUERY
  SELECT c.id, c.started_at,
    pa.alias, pa.telegram_user_id,
    pb.alias, pb.telegram_user_id,
    (SELECT count(*) FROM public.messages m WHERE m.conversation_id = c.id),
    (SELECT max(m.created_at) FROM public.messages m WHERE m.conversation_id = c.id)
  FROM public.conversations c
  JOIN public.profiles pa ON pa.id = c.user_a
  JOIN public.profiles pb ON pb.id = c.user_b
  WHERE c.status = 'active'
  ORDER BY c.started_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_session_messages(_conversation_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE(id uuid, sender_alias text, sender_tg bigint, content text, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'access denied: owner only';
  END IF;
  RETURN QUERY
  SELECT m.id, p.alias, p.telegram_user_id, m.content, m.created_at
  FROM public.messages m
  JOIN public.profiles p ON p.id = m.sender_id
  WHERE m.conversation_id = _conversation_id
  ORDER BY m.created_at DESC
  LIMIT LEAST(_limit, 500);
END;
$$;

-- Webhook log helper
CREATE OR REPLACE FUNCTION public.record_webhook_event(
  _source text, _event text, _level text, _message text,
  _status_code integer DEFAULT NULL, _payload jsonb DEFAULT NULL, _duration_ms integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.webhook_logs (source, event, level, message, status_code, payload, duration_ms)
  VALUES (_source, _event, COALESCE(_level,'info'), _message, _status_code, _payload, _duration_ms)
  RETURNING id INTO rid;
  DELETE FROM public.webhook_logs WHERE created_at < now() - interval '30 days';
  RETURN rid;
END;
$$;

-- Admin password meta
CREATE OR REPLACE FUNCTION public.admin_password_meta(_profile_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE pid uuid; meta RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'access denied: admin only';
  END IF;
  pid := COALESCE(_profile_id, public.current_profile_id(),
    (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1));
  IF pid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no profile');
  END IF;
  SELECT * INTO meta FROM public.admin_credentials WHERE profile_id = pid;
  IF meta IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'password_changed_at', null, 'expires_at', null, 'expired', false, 'force_rotate', false);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'password_changed_at', meta.password_changed_at,
    'expires_at', meta.password_expires_at,
    'expired', meta.password_expires_at < now(),
    'force_rotate', meta.force_rotate,
    'last_login_at', meta.last_login_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_admin_password_changed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE pid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO pid FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
  IF pid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no profile'); END IF;
  INSERT INTO public.admin_credentials (profile_id, password_changed_at, password_expires_at, force_rotate)
  VALUES (pid, now(), now() + interval '90 days', false)
  ON CONFLICT (profile_id) DO UPDATE
    SET password_changed_at = now(),
        password_expires_at = now() + interval '90 days',
        force_rotate = false,
        updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_monthly_unban_credits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n int;
BEGIN
  UPDATE public.profiles
  SET monthly_unban_credit_used = false,
      monthly_unban_credit_reset_at = (date_trunc('month', now()) + interval '1 month')
  WHERE monthly_unban_credit_reset_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Update admin_dashboard_stats to include unban + webhook errors
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'access denied: admin only';
  END IF;
  SELECT jsonb_build_object(
    'total_users',         (SELECT count(*) FROM public.profiles WHERE telegram_user_id <> -777000777 AND telegram_user_id > -1000000),
    'premium_users',       (SELECT count(*) FROM public.profiles WHERE is_premium = true),
    'banned_users',        (SELECT count(*) FROM public.profiles WHERE is_banned_until IS NOT NULL AND is_banned_until > now()),
    'active_chats',        (SELECT count(*) FROM public.conversations WHERE status = 'active'),
    'total_conversations', (SELECT count(*) FROM public.conversations),
    'pending_payments',    (SELECT count(*) FROM public.payment_requests WHERE status = 'pending' AND payment_kind='premium'),
    'approved_payments',   (SELECT count(*) FROM public.payment_requests WHERE status = 'approved' AND payment_kind='premium'),
    'rejected_payments',   (SELECT count(*) FROM public.payment_requests WHERE status = 'rejected' AND payment_kind='premium'),
    'pending_unbans',      (SELECT count(*) FROM public.payment_requests WHERE status = 'pending' AND payment_kind='unban'),
    'approved_unbans',     (SELECT count(*) FROM public.payment_requests WHERE status = 'approved' AND payment_kind='unban'),
    'reports_24h',         (SELECT count(*) FROM public.user_reports WHERE created_at > now() - interval '24 hours'),
    'bot_signals_24h',     (SELECT count(*) FROM public.bot_signals WHERE created_at > now() - interval '24 hours'),
    'webhook_errors_24h',  (SELECT count(*) FROM public.webhook_logs WHERE level IN ('error','critical') AND created_at > now() - interval '24 hours'),
    'queue_waiting',       (SELECT count(*) FROM public.match_queue WHERE status = 'waiting')
  ) INTO result;
  RETURN result;
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION
  public.add_admin_role(text), public.remove_admin_role(text), public.list_admins(),
  public.request_unban(uuid, text), public.approve_unban_payment(text, uuid, text),
  public.reject_unban_payment(text, uuid, text),
  public.owner_active_sessions(), public.owner_session_messages(uuid, integer),
  public.record_webhook_event(text, text, text, text, integer, jsonb, integer),
  public.admin_password_meta(uuid), public.mark_admin_password_changed(),
  public.is_owner(), public.link_owner_auth_user(uuid, text),
  public.reset_monthly_unban_credits()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.add_admin_role(text), public.remove_admin_role(text), public.list_admins(),
  public.owner_active_sessions(), public.owner_session_messages(uuid, integer),
  public.admin_password_meta(uuid), public.mark_admin_password_changed(),
  public.is_owner(), public.link_owner_auth_user(uuid, text)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.request_unban(uuid, text), public.approve_unban_payment(text, uuid, text),
  public.reject_unban_payment(text, uuid, text),
  public.record_webhook_event(text, text, text, text, integer, jsonb, integer),
  public.reset_monthly_unban_credits()
TO service_role;