-- =========================================================
-- Feature: /nonai preference column
-- =========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS no_ai BOOLEAN NOT NULL DEFAULT false;

-- =========================================================
-- Feature: Admin helper — cancel a false-positive bot signal
-- Restores trust +10 and clears ban on the affected profile.
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_cancel_bot_signal(
  _signal_id UUID,
  _admin_id  UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sig RECORD;
  new_score INT;
BEGIN
  SELECT * INTO sig FROM public.bot_signals WHERE id = _signal_id;
  IF sig IS NULL THEN RETURN FALSE; END IF;

  -- Restore trust +10 (up to cap 150)
  UPDATE public.profiles
  SET trust_score    = LEAST(150, trust_score + 10),
      is_banned_until = NULL,
      ban_reason      = NULL,
      updated_at      = now()
  WHERE id = sig.profile_id
  RETURNING trust_score INTO new_score;

  -- Audit trail
  INSERT INTO public.trust_events (
    profile_id, event_type, delta, new_score, reason
  ) VALUES (
    sig.profile_id,
    'manual',
    10,
    new_score,
    'Salah deteksi dibatalkan admin (signal id=' || _signal_id || ')'
  );

  -- Mark signal cancelled (nested jsonb_set to set both keys in one UPDATE)
  UPDATE public.bot_signals
  SET details = jsonb_set(
    jsonb_set(
      COALESCE(details, '{}'::jsonb),
      '{cancelled}',
      to_jsonb(true)
    ),
    '{cancelled_by}',
    to_jsonb(_admin_id::text)
  )
  WHERE id = _signal_id;

  RETURN TRUE;
END;
$$;

-- =========================================================
-- Index to support /admin bot-signals per-user queries
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_bot_signals_created
  ON public.bot_signals (created_at DESC);
