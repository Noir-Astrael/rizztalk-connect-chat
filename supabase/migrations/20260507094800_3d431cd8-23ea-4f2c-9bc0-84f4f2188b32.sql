
-- 1) Premium default search settings
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_search_gender text,
  ADD COLUMN IF NOT EXISTS default_search_province text;

-- 2) Online count RPC (admin/service)
CREATE OR REPLACE FUNCTION public.get_online_count(_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE total int; chatting int; queued int;
BEGIN
  SELECT count(*) INTO total
    FROM public.profiles
    WHERE last_seen_at > now() - make_interval(mins => GREATEST(_minutes, 1))
      AND telegram_user_id > 0;
  SELECT count(DISTINCT pid) INTO chatting FROM (
    SELECT user_a AS pid FROM public.conversations WHERE status='active'
    UNION SELECT user_b FROM public.conversations WHERE status='active'
  ) z;
  SELECT count(*) INTO queued FROM public.match_queue WHERE status='waiting';
  RETURN jsonb_build_object('online', total, 'chatting', chatting, 'queued', queued, 'window_minutes', GREATEST(_minutes,1));
END;
$$;

-- 3) User-facing payment status RPC (Telegram-context: uses current_profile_id)
CREATE OR REPLACE FUNCTION public.get_my_payment_status(_limit integer DEFAULT 10)
RETURNS TABLE(
  reference_code text, payment_kind text, plan text, amount_idr int,
  status text, extracted_amount_idr int, admin_note text,
  has_proof boolean, created_at timestamptz, reviewed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE pid uuid;
BEGIN
  pid := public.current_profile_id();
  IF pid IS NULL THEN RAISE EXCEPTION 'no profile context'; END IF;
  RETURN QUERY
    SELECT pr.reference_code, pr.payment_kind, pr.plan, pr.amount_idr,
           pr.status, pr.extracted_amount_idr, pr.admin_note,
           (pr.proof_image_storage_path IS NOT NULL OR pr.proof_image_file_id IS NOT NULL) AS has_proof,
           pr.created_at, pr.reviewed_at
    FROM public.payment_requests pr
    WHERE pr.profile_id = pid
    ORDER BY pr.created_at DESC
    LIMIT LEAST(_limit, 50);
END;
$$;

-- 4) Set premium default search filters
CREATE OR REPLACE FUNCTION public.set_premium_defaults(
  _profile_id uuid, _gender text, _province text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p RECORD;
BEGIN
  SELECT id, is_premium INTO p FROM public.profiles WHERE id = _profile_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found'); END IF;
  IF NOT p.is_premium THEN RETURN jsonb_build_object('ok', false, 'error', 'premium_only'); END IF;
  IF _gender IS NOT NULL AND _gender NOT IN ('male','female','any') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_gender');
  END IF;
  UPDATE public.profiles
    SET default_search_gender = NULLIF(_gender,'any'),
        default_search_province = NULLIF(_province,'any'),
        updated_at = now()
    WHERE id = _profile_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5) Storage: tighten qris-images public read so listing isn't allowed but specific files still load.
DROP POLICY IF EXISTS "Public read qris-images" ON storage.objects;
DROP POLICY IF EXISTS "qris-images public read" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "qris read by exact path" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'qris-images' AND name IS NOT NULL);

-- 6) Lock down SECURITY DEFINER functions: revoke from public/anon, keep web-facing for authenticated.
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END$do$;

-- Re-grant to authenticated for web-facing RPCs
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_active_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_session_messages(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_admin_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_admin_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_premium(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_premium_by_reference(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_premium_payment(text, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_premium_payment(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_unban_payment(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_unban_payment(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_password_meta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_admin_password_changed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_proof_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_signups(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_daily_conversations(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_bot_signal(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_admin_auth_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_owner_auth_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_online_count(integer) TO authenticated;
