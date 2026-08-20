-- 175 — Que el agente pueda BUSCAR en el catálogo.
--
-- El problema: el agente sólo conoce los productos que entran en su prompt.
-- `loadProductCatalog` manda 80 y `detectInboundProduct` lee 500 sin orden.
-- Con un catálogo más grande que eso, el resto no existe: no lo puede
-- recomendar, no lo puede cotizar, y ni siquiera sabe que está a la venta.
-- Subir el número no arregla nada — el prompt tiene un techo y meterle mil
-- productos empeora todas las respuestas, no sólo las de catálogo.
--
-- Lo que hace falta es buscar en la tabla en vez de memorizarla. Estos índices
-- son lo que hace que esa búsqueda sea instantánea sobre cualquier catálogo.
--
-- `pg_trgm` ya está instalado y ya se usa así sobre `messages.content_text`
-- (migración 029), y `f_unaccent` ya existe (056): esto es aplicar el mismo
-- patrón a los productos, que era el que faltaba.
--
-- APLICAR A MANO por la Management API antes de desplegar el código que busca.

-- Título: es por donde busca casi siempre ("tienen el serum de vitamina C?").
-- Sin tildes, porque nadie las escribe al preguntar.
CREATE INDEX IF NOT EXISTS shopify_products_title_trgm_idx
  ON shopify_products USING gin (f_unaccent(title) gin_trgm_ops);

-- Descripción: para la pregunta que no nombra el producto sino lo que hace
-- ("algo para piel sensible"), que es justo donde un catálogo grande se pierde.
CREATE INDEX IF NOT EXISTS shopify_products_description_trgm_idx
  ON shopify_products USING gin (f_unaccent(coalesce(description, '')) gin_trgm_ops);

-- Etiquetas: el comercio agrupa por ahí ("verano", "regalo", "sin gluten") y es
-- como pregunta quien no sabe el nombre del producto.
CREATE INDEX IF NOT EXISTS shopify_products_tags_idx
  ON shopify_products USING gin (tags);

-- Variantes dentro del volcado crudo de la tienda.
--
-- La tarjeta de producto del chat web resuelve el producto desde el id de
-- variante que viaja en el enlace de carrito (`/api/widget/product`), y ese
-- `raw->'variants' @> …` venía haciendo un escaneo secuencial: es rápido con
-- cinco productos y deja de serlo con quinientos, en el único endpoint que se
-- llama por cada tarjeta que se dibuja.
--
-- `jsonb_path_ops` y no el operador por defecto: sólo soporta `@>`, que es
-- exactamente lo que se consulta, y a cambio el índice es bastante más chico.
CREATE INDEX IF NOT EXISTS shopify_products_raw_variants_idx
  ON shopify_products USING gin ((raw -> 'variants') jsonb_path_ops);

COMMENT ON INDEX shopify_products_title_trgm_idx IS
  'Búsqueda por nombre del agente de IA (buscar_producto). Sin tildes: nadie las escribe al preguntar.';
