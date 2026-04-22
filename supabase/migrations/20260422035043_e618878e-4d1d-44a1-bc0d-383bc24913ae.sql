-- 1. Indexes for cleanup performance
CREATE INDEX IF NOT EXISTS idx_conversations_ended_at ON public.conversations(ended_at) WHERE ended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_match_queue_status_joined ON public.match_queue(status, joined_at);

-- 2. Payment requests table
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'monthly',
  amount_idr INT NOT NULL,
  method TEXT NOT NULL DEFAULT 'manual_transfer',
  status TEXT NOT NULL DEFAULT 'pending',
  reference_code TEXT NOT NULL UNIQUE,
  proof_note TEXT,
  admin_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payment requests"
  ON public.payment_requests FOR SELECT TO authenticated
  USING (profile_id = current_profile_id() OR is_admin());

CREATE POLICY "Users can create own payment requests"
  ON public.payment_requests FOR INSERT TO authenticated
  WITH CHECK (profile_id = current_profile_id());

CREATE POLICY "Admins manage payment requests"
  ON public.payment_requests FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER update_payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_profile ON public.payment_requests(profile_id, created_at DESC);

-- 3. Bot signals (audit trail for bot detection)
CREATE TABLE IF NOT EXISTS public.bot_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL,
  score NUMERIC NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage bot signals"
  ON public.bot_signals FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS idx_bot_signals_profile ON public.bot_signals(profile_id, created_at DESC);

-- 4. Rate limits (sliding window per command)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 1,
  UNIQUE(profile_id, bucket)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage rate limits"
  ON public.rate_limits FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON public.rate_limits(profile_id, bucket);

-- 5. Function: purge messages 1h after conversation ended
CREATE OR REPLACE FUNCTION public.purge_old_messages()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH del AS (
    DELETE FROM public.messages m
    USING public.conversations c
    WHERE m.conversation_id = c.id
      AND c.status = 'ended'
      AND c.ended_at IS NOT NULL
      AND c.ended_at < now() - INTERVAL '1 hour'
    RETURNING m.id
  )
  SELECT COUNT(*) INTO deleted_count FROM del;
  RETURN deleted_count;
END;
$$;

-- 6. Sliding-window rate limit check (returns true if allowed)
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _profile_id UUID,
  _bucket TEXT,
  _max_count INT,
  _window_seconds INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
  win_start TIMESTAMPTZ;
BEGIN
  SELECT count, window_start INTO current_count, win_start
  FROM public.rate_limits
  WHERE profile_id = _profile_id AND bucket = _bucket;

  IF current_count IS NULL THEN
    INSERT INTO public.rate_limits (profile_id, bucket, count, window_start)
    VALUES (_profile_id, _bucket, 1, now());
    RETURN TRUE;
  END IF;

  IF win_start < now() - (_window_seconds || ' seconds')::INTERVAL THEN
    UPDATE public.rate_limits
    SET count = 1, window_start = now()
    WHERE profile_id = _profile_id AND bucket = _bucket;
    RETURN TRUE;
  END IF;

  IF current_count >= _max_count THEN
    RETURN FALSE;
  END IF;

  UPDATE public.rate_limits
  SET count = count + 1
  WHERE profile_id = _profile_id AND bucket = _bucket;
  RETURN TRUE;
END;
$$;

-- 7. Premium upgrade request helper
CREATE OR REPLACE FUNCTION public.request_premium_upgrade(
  _profile_id UUID,
  _plan TEXT,
  _amount_idr INT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_code TEXT;
BEGIN
  -- short reference: RZT-<6char>
  ref_code := 'RZT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  INSERT INTO public.payment_requests (profile_id, plan, amount_idr, reference_code)
  VALUES (_profile_id, _plan, _amount_idr, ref_code);

  RETURN ref_code;
END;
$$;

-- 8. Admin: approve payment → grant premium for N days
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

-- 9. Admin: reject payment
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