-- ============================================================
-- 074_product_media_and_websites.sql
--
-- Premium product editor (matches the riverz reference UI):
--   - images   JSONB  — ordered gallery of image URLs. First one mirrors
--                       image_url (the list thumbnail) for compatibility.
--   - websites JSONB   — up to 5 source URLs the agent learns from. First
--                       one mirrors `url` (kept for existing scrape code).
--
-- Multi-offer pricing reuses the existing allowed_offers column
-- ([{label,total,conditions}]) — promoted to the top "Precios de venta"
-- section — so no new pricing column is needed; price_min/price_max are
-- derived from it on save for the catalog/runner.
--
-- Also creates the `product-media` Storage bucket so merchants can upload
-- their own product photos (manual products / extra angles). Mirrors the
-- `avatars` bucket conventions from migration 008.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE shopify_products
  ADD COLUMN IF NOT EXISTS images JSONB,
  ADD COLUMN IF NOT EXISTS websites JSONB;

COMMENT ON COLUMN shopify_products.images IS
  'Ordered gallery of image URLs; images[0] mirrors image_url (list thumbnail).';
COMMENT ON COLUMN shopify_products.websites IS
  'Up to 5 source URLs the agent learns from; websites[0] mirrors url.';

-- ---- Storage: product-media bucket ----
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-media',
  'product-media',
  TRUE,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path convention: product-media/{auth.uid()}/<file>
DROP POLICY IF EXISTS "Product media is publicly readable" ON storage.objects;
CREATE POLICY "Product media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "Users can upload product media" ON storage.objects;
CREATE POLICY "Users can upload product media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update product media" ON storage.objects;
CREATE POLICY "Users can update product media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete product media" ON storage.objects;
CREATE POLICY "Users can delete product media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
