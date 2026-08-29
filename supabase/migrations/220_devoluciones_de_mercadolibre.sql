-- Devoluciones que NACEN en la plataforma, no en el chat.
--
-- `returns` se diseñó para el caso en que la clienta pide la devolución por
-- WhatsApp y el agente abre el caso. Pero en Mercado Libre la devolución se
-- abre DENTRO de Mercado Libre —el comprador aprieta "devolver" y la
-- plataforma arma el expediente— y esa devolución no aparecía en ningún lado
-- de Riverz: /devoluciones mostraba sólo lo que el agente había abierto a
-- mano, así que la lista decía "ninguna" mientras la plataforma tramitaba una.
--
-- Para espejarlas hace falta una clave estable: el id del reclamo de la
-- plataforma. Sin ella cada corrida del sincronizador insertaría la misma
-- devolución otra vez.
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS platform    text,
  ADD COLUMN IF NOT EXISTS external_id text,
  -- Adónde ir a resolverla: la gestión (aprobar, reembolsar, mandar etiqueta)
  -- sigue ocurriendo en la plataforma.
  ADD COLUMN IF NOT EXISTS external_url text;

-- Una fila por devolución de la plataforma. Es un índice único parcial: las
-- devoluciones abiertas desde el chat siguen sin external_id y no lo tocan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_externa
  ON returns (workspace_id, platform, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON COLUMN returns.platform IS
  'Plataforma donde nació la devolución (mercadolibre, shopify…). NULL = la abrió el agente desde el chat.';
COMMENT ON COLUMN returns.external_id IS
  'Id del expediente en la plataforma. Clave de deduplicación del sincronizador.';
