-- Cada publicación puede quedar ligada a uno o más productos del catálogo.
-- Es un dato derivado del caption, la imagen o la transcripción; nunca sustituye
-- la ficha Shopify ni inventa precio, stock o promociones.
ALTER TABLE publicacion_contexto
  ADD COLUMN IF NOT EXISTS product_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS product_match_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS product_matched_at TIMESTAMPTZ;

ALTER TABLE publicacion_contexto
  DROP CONSTRAINT IF EXISTS publicacion_contexto_product_match_status_check;
ALTER TABLE publicacion_contexto
  ADD CONSTRAINT publicacion_contexto_product_match_status_check
  CHECK (product_match_status IN ('pending', 'identified', 'ambiguous', 'unidentified'));

CREATE INDEX IF NOT EXISTS publicacion_contexto_product_ids_idx
  ON publicacion_contexto USING GIN (product_ids);

COMMENT ON COLUMN publicacion_contexto.product_ids IS
  'Productos del catálogo identificados de forma determinista en caption, análisis de imagen o transcripción.';
