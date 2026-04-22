-- =========================================================
-- Feature: QRIS Payment — update default payment method
-- =========================================================

-- Update default payment method on payment_requests to 'qris'
ALTER TABLE public.payment_requests
  ALTER COLUMN method SET DEFAULT 'qris';

-- Back-fill existing pending requests to 'qris' (optional, only pending ones)
-- UPDATE public.payment_requests
--   SET method = 'qris'
--   WHERE status = 'pending' AND method = 'manual_transfer';

-- =========================================================
-- Storage: create public 'assets' bucket for QRIS image
-- (Run this in Supabase Dashboard > Storage if bucket not exists)
-- =========================================================
-- NOTE: Storage bucket creation is done via Supabase Dashboard or CLI:
--   supabase storage create-bucket assets --public
-- Then upload qris.jpg to the 'assets' bucket.
-- Public URL format:
--   https://<project-ref>.supabase.co/storage/v1/object/public/assets/qris.jpg
--
-- After uploading, set the env var in Supabase:
--   QRIS_IMAGE_URL = https://lrhxtsnammweqylqbsuv.supabase.co/storage/v1/object/public/assets/qris.jpg

-- =========================================================
-- Index to speed up payment status lookups
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_payment_requests_method
  ON public.payment_requests (method, status, created_at DESC);
