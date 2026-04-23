INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('qris-images', 'qris-images', true)
ON CONFLICT (id) DO NOTHING;

-- QRIS public read
DROP POLICY IF EXISTS "QRIS images public read" ON storage.objects;
CREATE POLICY "QRIS images public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'qris-images');

-- Admin/owner manage QRIS images
DROP POLICY IF EXISTS "Admins manage qris" ON storage.objects;
CREATE POLICY "Admins manage qris" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'qris-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'qris-images' AND public.is_admin());

-- Payment proofs: only admins can read; service-role inserts
DROP POLICY IF EXISTS "Admins view payment proofs" ON storage.objects;
CREATE POLICY "Admins view payment proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.is_admin());