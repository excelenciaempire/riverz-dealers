-- El costo del día, abierto por modelo y por bolsillo.
--
-- `billing_usage_daily.costo_usd` ya es el único número de costo que cuenta la
-- caché —el 82% de lo que se paga por respuesta— y por eso pasa a ser la fuente
-- única de todo el panel. Pero es un total: no alcanza para dos preguntas que
-- el panel sí hace.
--
--  1. **¿Cuánto le debo a Anthropic este mes?** La fila de cada proveedor
--     prorrateaba el total por tokens y sumaba TODOS los modelos bajo la
--     etiqueta «Anthropic»: una caída al respaldo de Groq se contabilizaba como
--     gasto de Anthropic. Y el prorrateo por tokens tampoco servía, porque
--     entre Haiku (1 USD/M) y Opus (5 USD/M) la proporción de tokens no es la
--     proporción de costo.
--  2. **¿Cuánto puse yo y cuánto puso el comercio?** El reparto entre el
--     bolsillo de Riverz y el propio se estimaba con la misma regla de tres.
--
-- Las dos se contestan guardando el corte al acumular, que es el único momento
-- en que se tiene la fila con su modelo y su `key_source` al lado del costo.
--
-- Forma: { "claude-haiku-4-5": { "usd": 1.23, "plataforma_usd": 0.98 }, ... }
-- donde `plataforma_usd` es la parte que salió con la llave de Riverz
-- (`ai_replies.key_source <> 'agent'`).
--
-- Las filas anteriores a esta migración quedan en NULL y se leen como «sin
-- desglose», nunca como cero: el `key_source` de un agregado que no lo guardó
-- no se puede reconstruir, y un cero haría parecer que un proveedor no se usa.

ALTER TABLE public.billing_usage_daily
  ADD COLUMN IF NOT EXISTS costo_por_modelo JSONB;

COMMENT ON COLUMN public.billing_usage_daily.costo_por_modelo IS
  'Costo del día abierto por modelo: {"<modelo>": {"usd": n, "plataforma_usd": n}}. `plataforma_usd` es lo que salió con la llave de Riverz (key_source <> agent). NULL en las filas anteriores a la migración 230: es «sin desglose», no cero.';
