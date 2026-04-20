-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.gender_type AS ENUM ('male', 'female', 'other');
CREATE TYPE public.gender_preference AS ENUM ('male', 'female', 'any');
CREATE TYPE public.queue_status AS ENUM ('waiting', 'matched', 'cancelled');
CREATE TYPE public.conversation_status AS ENUM ('active', 'ended');
CREATE TYPE public.interest_kind AS ENUM ('preset', 'custom');

-- =========================================================
-- UTILITY: updated_at trigger function
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- PROFILES (Telegram-first identity)
-- =========================================================
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL UNIQUE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  alias TEXT NOT NULL,
  gender public.gender_type,
  gender_preference public.gender_preference NOT NULL DEFAULT 'any',
  birth_year INT CHECK (birth_year IS NULL OR (birth_year >= 1900 AND birth_year <= EXTRACT(YEAR FROM now())::int - 13)),
  province_code TEXT,
  province_name TEXT,
  bio TEXT CHECK (bio IS NULL OR char_length(bio) <= 200),
  trust_score INT NOT NULL DEFAULT 100 CHECK (trust_score >= 0 AND trust_score <= 200),
  is_premium BOOLEAN NOT NULL DEFAULT false,
  premium_until TIMESTAMPTZ,
  is_banned_until TIMESTAMPTZ,
  ban_reason TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  language_code TEXT NOT NULL DEFAULT 'id',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_province ON public.profiles (province_code) WHERE province_code IS NOT NULL;
CREATE INDEX idx_profiles_telegram_user ON public.profiles (telegram_user_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- USER_ROLES (separate table — required to avoid privilege escalation)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER function to check roles (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_profile_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE profile_id = _profile_id
      AND role = _role
  );
$$;

-- Helper: current authenticated profile (for web admin login later)
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles
  WHERE telegram_user_id = COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'telegram_user_id', '')::bigint,
    -1
  )
  LIMIT 1;
$$;

-- Helper: check if currently authenticated user is an admin (web auth context)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
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
      AND p.id = public.current_profile_id()
  );
$$;

-- =========================================================
-- USER_INTERESTS
-- =========================================================
CREATE TABLE public.user_interests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (char_length(tag) BETWEEN 2 AND 30),
  kind public.interest_kind NOT NULL DEFAULT 'preset',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, tag)
);

CREATE INDEX idx_user_interests_tag ON public.user_interests (tag);
CREATE INDEX idx_user_interests_profile ON public.user_interests (profile_id);

ALTER TABLE public.user_interests ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- MATCH_QUEUE
-- =========================================================
CREATE TABLE public.match_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  province_code TEXT,
  gender public.gender_type,
  gender_preference public.gender_preference NOT NULL DEFAULT 'any',
  is_premium BOOLEAN NOT NULL DEFAULT false,
  status public.queue_status NOT NULL DEFAULT 'waiting',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_queue_status_joined ON public.match_queue (status, joined_at);
CREATE INDEX idx_match_queue_province ON public.match_queue (province_code, status);

ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_match_queue_updated_at
BEFORE UPDATE ON public.match_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- CONVERSATIONS
-- =========================================================
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  same_province BOOLEAN NOT NULL DEFAULT false,
  match_score INT NOT NULL DEFAULT 0,
  status public.conversation_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES public.profiles(id),
  CHECK (user_a <> user_b)
);

CREATE INDEX idx_conversations_user_a ON public.conversations (user_a, status);
CREATE INDEX idx_conversations_user_b ON public.conversations (user_b, status);
CREATE UNIQUE INDEX idx_conversations_active_user_a ON public.conversations (user_a) WHERE status = 'active';
CREATE UNIQUE INDEX idx_conversations_active_user_b ON public.conversations (user_b) WHERE status = 'active';

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- MESSAGES
-- =========================================================
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_created ON public.messages (conversation_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- TELEGRAM BOT STATE & LOG
-- =========================================================
CREATE TABLE public.telegram_bot_state (
  id INT PRIMARY KEY CHECK (id = 1),
  update_offset BIGINT NOT NULL DEFAULT 0,
  last_polled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0);

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_telegram_bot_state_updated_at
BEFORE UPDATE ON public.telegram_bot_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.telegram_updates_log (
  update_id BIGINT PRIMARY KEY,
  chat_id BIGINT,
  from_user_id BIGINT,
  raw_update JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_updates_log_chat ON public.telegram_updates_log (chat_id);
CREATE INDEX idx_telegram_updates_log_from ON public.telegram_updates_log (from_user_id);

ALTER TABLE public.telegram_updates_log ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- BOT HELPER: find or create profile by telegram_user_id
-- =========================================================
CREATE OR REPLACE FUNCTION public.find_or_create_profile_by_telegram_id(
  _telegram_user_id BIGINT,
  _telegram_chat_id BIGINT,
  _telegram_username TEXT,
  _alias TEXT,
  _language_code TEXT DEFAULT 'id'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _profile_id UUID;
BEGIN
  SELECT id INTO _profile_id
  FROM public.profiles
  WHERE telegram_user_id = _telegram_user_id;

  IF _profile_id IS NULL THEN
    INSERT INTO public.profiles (
      telegram_user_id, telegram_chat_id, telegram_username, alias, language_code
    ) VALUES (
      _telegram_user_id, _telegram_chat_id, _telegram_username, _alias, COALESCE(_language_code, 'id')
    )
    RETURNING id INTO _profile_id;

    -- Default user role
    INSERT INTO public.user_roles (profile_id, role) VALUES (_profile_id, 'user');
  ELSE
    UPDATE public.profiles
    SET telegram_chat_id = _telegram_chat_id,
        telegram_username = COALESCE(_telegram_username, telegram_username),
        last_seen_at = now()
    WHERE id = _profile_id;
  END IF;

  RETURN _profile_id;
END;
$$;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- ---------- profiles ----------
CREATE POLICY "Anyone authenticated can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = public.current_profile_id() OR public.is_admin())
WITH CHECK (id = public.current_profile_id() OR public.is_admin());

CREATE POLICY "Admins can insert profiles"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete profiles"
ON public.profiles FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------- user_roles ----------
CREATE POLICY "Users can view their own role"
ON public.user_roles FOR SELECT
TO authenticated
USING (profile_id = public.current_profile_id() OR public.is_admin());

CREATE POLICY "Only admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ---------- user_interests ----------
CREATE POLICY "Anyone authenticated can view interests"
ON public.user_interests FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can manage their own interests"
ON public.user_interests FOR ALL
TO authenticated
USING (profile_id = public.current_profile_id() OR public.is_admin())
WITH CHECK (profile_id = public.current_profile_id() OR public.is_admin());

-- ---------- match_queue ----------
CREATE POLICY "Users can view their own queue entry"
ON public.match_queue FOR SELECT
TO authenticated
USING (profile_id = public.current_profile_id() OR public.is_admin());

CREATE POLICY "Users can manage their own queue entry"
ON public.match_queue FOR ALL
TO authenticated
USING (profile_id = public.current_profile_id() OR public.is_admin())
WITH CHECK (profile_id = public.current_profile_id() OR public.is_admin());

-- ---------- conversations ----------
CREATE POLICY "Participants can view their conversations"
ON public.conversations FOR SELECT
TO authenticated
USING (
  user_a = public.current_profile_id()
  OR user_b = public.current_profile_id()
  OR public.is_admin()
);

CREATE POLICY "Participants can update their conversations"
ON public.conversations FOR UPDATE
TO authenticated
USING (
  user_a = public.current_profile_id()
  OR user_b = public.current_profile_id()
  OR public.is_admin()
)
WITH CHECK (
  user_a = public.current_profile_id()
  OR user_b = public.current_profile_id()
  OR public.is_admin()
);

CREATE POLICY "Admins can insert conversations"
ON public.conversations FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete conversations"
ON public.conversations FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------- messages ----------
CREATE POLICY "Participants can view messages"
ON public.messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.user_a = public.current_profile_id() OR c.user_b = public.current_profile_id())
  )
  OR public.is_admin()
);

CREATE POLICY "Participants can send messages"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = public.current_profile_id()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND c.status = 'active'
      AND (c.user_a = public.current_profile_id() OR c.user_b = public.current_profile_id())
  )
);

CREATE POLICY "Admins can manage all messages"
ON public.messages FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ---------- telegram state & log (admin only via web; service role bypasses) ----------
CREATE POLICY "Only admins can view bot state"
ON public.telegram_bot_state FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Only admins can update bot state"
ON public.telegram_bot_state FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Only admins can view updates log"
ON public.telegram_updates_log FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Only admins can manage updates log"
ON public.telegram_updates_log FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- =========================================================
-- REALTIME
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.match_queue REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;