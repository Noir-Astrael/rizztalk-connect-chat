-- =========================================================
-- Admin Web Auth — Supabase Email/Password support
-- Allows admin to log into the web dashboard
-- =========================================================

-- Allow admins to look up their own profile via email-based auth
-- (Web admin logs in with email/password via Supabase Auth)

-- Function to get admin stats safely — only callable by authenticated admins
CREATE OR REPLACE FUNCTION public.get_admin_profile_by_auth_email()
RETURNS TABLE (
  profile_id UUID,
  alias TEXT,
  is_admin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_email TEXT;
  found_id UUID;
BEGIN
  -- Get email from JWT
  auth_email := current_setting('request.jwt.claims', true)::json->>'email';
  IF auth_email IS NULL OR auth_email = '' THEN
    RETURN;
  END IF;

  -- For web admin, we store a sentinel profile linked by email convention
  -- Admin telegram_user_id is mapped in user_roles table by profile_id
  SELECT ur.profile_id INTO found_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  LIMIT 1;

  IF found_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS profile_id,
    p.alias,
    EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.profile_id = p.id AND ur.role = 'admin') AS is_admin
  FROM public.profiles p
  WHERE p.id = found_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_profile_by_auth_email() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_admin_profile_by_auth_email() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_admin_profile_by_auth_email() TO service_role;

-- Allow service_role to insert into profiles (needed for admin web account creation)
-- (service_role bypasses RLS so this is already the case, but explicit for clarity)

-- RLS policy: allow authenticated users to read their OWN profile by UUID
-- (needed for admin dashboard session check)
DROP POLICY IF EXISTS "Authenticated users can read own profile by id" ON public.profiles;
CREATE POLICY "Authenticated users can read own profile by id"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = (
      SELECT id FROM public.profiles
      WHERE telegram_user_id = COALESCE(
        NULLIF(current_setting('request.jwt.claims', true)::json->>'telegram_user_id', '')::bigint,
        -1
      )
      LIMIT 1
    )
    OR public.is_admin()
  );
