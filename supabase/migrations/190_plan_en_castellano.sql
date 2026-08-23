-- 190 — El plan, contado para quien lo aprueba
--
-- `encargo` es la instrucción que recibe el especialista: lleva el nombre exacto
-- de la plantilla, el disparador, los días de espera. Tiene que llevarlos —el
-- que la recibe no leyó la conversación— y por eso mismo no es lo que se le
-- muestra a la persona que decide. En pantalla quedaba «Escribe y manda a
-- aprobar tres plantillas de WhatsApp para recompra del Serum Pilar a los 21
-- días sin volver a comprar: recompra_serum_1u (recordatorio de que se le debe
-- estar acabando, para quien compró 1 unidad),…», cortado a la mitad.
--
-- Un plan que hay que aprobar se lee en dos segundos o no se lee. `que` es esa
-- línea: qué va a pasar, en castellano, sin nombres de código.
--
-- Se separa en vez de acortar el encargo porque son dos textos con dos trabajos
-- distintos, y hacer que uno haga los dos los empeora a los dos: un encargo
-- escrito para que se lea lindo pierde el detalle que el especialista necesita.
--
-- Idempotente.

ALTER TABLE operator_plan_steps
  ADD COLUMN IF NOT EXISTS que TEXT;

COMMENT ON COLUMN operator_plan_steps.que IS
  'Qué hace este paso, en una línea y en castellano. Es lo que se muestra al aprobar; el encargo es lo que recibe el especialista.';
