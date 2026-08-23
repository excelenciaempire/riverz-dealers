-- ============================================================
-- 183: un producto, muchas publicaciones
-- ============================================================
-- El mismo producto vive una vez por plataforma. El serum de Pilar son cuatro
-- filas: la de Shopify —con la página leída y 10.400 caracteres de
-- conocimiento— y tres publicaciones de Mercado Libre (x1, x2, x3) con el
-- conocimiento vacío. Para el comercio es UN producto; para la base eran
-- cuatro, y el agente contestaba distinto según por dónde le escribieran.
--
-- No se fusionan las filas en una: cada plataforma sincroniza la suya y tiene
-- datos que son suyos y sólo suyos —su precio (el serum sale 39.990 en Shopify
-- y 45.000 en Mercado Libre por las comisiones), su URL, su id externo, su
-- stock—. Borrarlas rompería la consulta de pedidos y el próximo sync las
-- recrearía igual.
--
-- Lo que se unifica es el CONOCIMIENTO: una fila manda y las demás cuelgan de
-- ella. Se carga una vez y el agente contesta lo mismo por todos los canales,
-- mientras cada publicación conserva su precio y su enlace.
ALTER TABLE shopify_products
  ADD COLUMN IF NOT EXISTS master_id uuid REFERENCES shopify_products(id) ON DELETE SET NULL;

COMMENT ON COLUMN shopify_products.master_id IS
  'La fila que manda el conocimiento. NULL = esta fila es la principal.';

-- Una publicación no puede ser principal de nadie Y colgar de otra: sin esto
-- una cadena A→B→C dejaría el conocimiento en un lugar que nadie resuelve.
-- La regla se aplica al escribir (`unificarProductos`); el índice es para
-- encontrar rápido a los hijos de una principal.
CREATE INDEX IF NOT EXISTS idx_shopify_products_master
  ON shopify_products (master_id)
  WHERE master_id IS NOT NULL;

-- Nadie puede colgar de sí mismo.
ALTER TABLE shopify_products
  DROP CONSTRAINT IF EXISTS shopify_products_master_no_self;
ALTER TABLE shopify_products
  ADD CONSTRAINT shopify_products_master_no_self
    CHECK (master_id IS NULL OR master_id <> id);
