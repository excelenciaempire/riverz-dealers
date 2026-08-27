-- 195 — El pliego de la marca
--
-- Al conectar la tienda ya sabemos QUÉ vende el comercio: catálogo, precios,
-- stock, moneda, país, el tono del sitio y las políticas que publica. Todo eso
-- se lee solo y no hace falta preguntarlo.
--
-- Lo que no está escrito en ningún lado son sus REGLAS: hasta cuánto descuento
-- puede dar la IA, si puede cancelar un pedido o devolver dinero, a qué hora se
-- le puede escribir a un cliente, qué escala a una persona. Sin eso, montar la
-- operación es adivinar — y adivinar acá es exactamente lo que el comercio
-- teme: que un bot invente un precio o prometa lo que no se puede cumplir.
--
-- `pliego` guarda esas respuestas, y es lo que el Operador lee para montar la
-- cuenta. Sólo se guardan las respuestas PROPIAS: lo que el comercio no
-- contestó no se escribe con su valor por defecto, así el día que ese defecto
-- cambie las cuentas a medio contestar se mueven con él en vez de quedar
-- congeladas en una decisión que nadie tomó.
--
-- Va sobre `operacion_setup`, que ya existe (165) y ya es una fila por
-- comercio con el estado de la activación. Una tabla nueva sería una segunda
-- fuente para la misma pregunta: "¿en qué quedó la instalación de esta cuenta?"
--
-- Idempotente. Se aplica a mano por la Management API.

ALTER TABLE operacion_setup
  ADD COLUMN IF NOT EXISTS pliego JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pliego_at TIMESTAMPTZ,
  -- Quién montó la operación. Cambia lo que ve el comercio al entrar: si la
  -- montó Riverz, le toca revisarla y aprobarla; si la montó él, ya la conoce.
  ADD COLUMN IF NOT EXISTS instalado_por TEXT
    CHECK (instalado_por IN ('comercio', 'riverz'));

COMMENT ON COLUMN operacion_setup.pliego IS
  'Respuestas del comercio a sus propias reglas. Sólo las contestadas: lo que falta cae al mínimo seguro del código.';
COMMENT ON COLUMN operacion_setup.pliego_at IS
  'Cuándo se tocó por última vez. Sirve para saber si el Operador montó la cuenta con el pliego vigente.';
