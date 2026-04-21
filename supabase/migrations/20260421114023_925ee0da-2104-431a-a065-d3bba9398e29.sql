-- Tabel riwayat perubahan trust score
CREATE TABLE public.trust_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('stop','block','report','reported','match_bonus','ban','manual')),
  delta INT NOT NULL,
  new_score INT NOT NULL,
  duration_sec INT,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_trust_events_profile_created ON public.trust_events (profile_id, created_at DESC);

ALTER TABLE public.trust_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own trust events"
ON public.trust_events FOR SELECT
TO authenticated
USING ((profile_id = current_profile_id()) OR is_admin());

CREATE POLICY "Admins manage trust events"
ON public.trust_events FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- Fungsi terpadu: ubah trust score & catat event dalam satu transaksi
CREATE OR REPLACE FUNCTION public.record_trust_event(
  _profile_id uuid,
  _delta int,
  _event_type text,
  _reason text,
  _conversation_id uuid DEFAULT NULL,
  _duration_sec int DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_score int;
BEGIN
  UPDATE public.profiles
  SET trust_score = LEAST(150, GREATEST(0, trust_score + _delta)),
      updated_at = now()
  WHERE id = _profile_id
  RETURNING trust_score INTO new_score;

  IF new_score IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.trust_events (
    profile_id, conversation_id, event_type, delta, new_score, duration_sec, reason
  ) VALUES (
    _profile_id, _conversation_id, _event_type, _delta, new_score, _duration_sec, _reason
  );

  RETURN new_score;
END;
$$;