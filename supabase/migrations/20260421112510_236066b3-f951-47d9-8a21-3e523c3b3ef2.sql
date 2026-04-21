CREATE OR REPLACE FUNCTION public.apply_trust_score_change(_profile_id uuid, _delta int)
RETURNS int
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
  RETURN new_score;
END;
$$;