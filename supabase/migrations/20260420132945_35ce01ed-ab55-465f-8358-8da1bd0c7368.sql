-- Enum untuk alasan report
CREATE TYPE public.report_reason AS ENUM ('spam', 'nsfw', 'bot', 'scam', 'harassment', 'other');
CREATE TYPE public.report_status AS ENUM ('pending', 'reviewed', 'dismissed');

-- Tabel user_reports
CREATE TABLE public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  reason public.report_reason NOT NULL DEFAULT 'other',
  note TEXT,
  status public.report_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT no_self_report CHECK (reporter_id <> reported_id)
);

CREATE INDEX idx_user_reports_reported_id ON public.user_reports(reported_id);
CREATE INDEX idx_user_reports_reporter_id ON public.user_reports(reporter_id);
CREATE INDEX idx_user_reports_created_at ON public.user_reports(created_at DESC);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create own reports"
  ON public.user_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = current_profile_id());

CREATE POLICY "Users can view own reports"
  ON public.user_reports FOR SELECT TO authenticated
  USING (reporter_id = current_profile_id() OR is_admin());

CREATE POLICY "Admins manage all reports"
  ON public.user_reports FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Tabel user_blocks
CREATE TABLE public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX idx_user_blocks_blocker ON public.user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks(blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blocks"
  ON public.user_blocks FOR ALL TO authenticated
  USING (blocker_id = current_profile_id() OR is_admin())
  WITH CHECK (blocker_id = current_profile_id() OR is_admin());

-- Trigger: turunkan trust score & auto-ban setelah report
CREATE OR REPLACE FUNCTION public.handle_new_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
BEGIN
  -- Turunkan trust score 5 poin (min 0)
  UPDATE public.profiles
  SET trust_score = GREATEST(0, trust_score - 5),
      updated_at = now()
  WHERE id = NEW.reported_id;

  -- Hitung report dalam 24 jam terakhir
  SELECT COUNT(*) INTO recent_count
  FROM public.user_reports
  WHERE reported_id = NEW.reported_id
    AND created_at > now() - INTERVAL '24 hours';

  -- Jika >= 5 report dalam 24 jam → auto-ban 24 jam
  IF recent_count >= 5 THEN
    UPDATE public.profiles
    SET is_banned_until = now() + INTERVAL '24 hours',
        ban_reason = 'Auto-ban: ' || recent_count || ' report dalam 24 jam',
        updated_at = now()
    WHERE id = NEW.reported_id
      AND (is_banned_until IS NULL OR is_banned_until < now() + INTERVAL '24 hours');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_user_report_created
  AFTER INSERT ON public.user_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_report();