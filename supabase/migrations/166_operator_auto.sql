-- 166 — Modo automático del Operador, y artefactos de lo que construye
--
-- Hasta acá el Operador SIEMPRE propone: deja una fila en `operator_actions` y
-- espera un click. Eso está bien cuando lo que sigue le llega a un cliente,
-- y sobra cuando lo único que hace es dejar una automatización PAUSADA que
-- después alguien va a revisar igual. Con seis aprobaciones seguidas, "pedile
-- lo que quieras y te lo arma" deja de sentirse así.
--
-- `auto_build` es esa elección, por comercio. Gobierna la CONSTRUCCIÓN, no el
-- envío: lo que se prende, le llega a una persona, sale a Meta o mueve dinero
-- sigue pidiendo un click en los dos modos. La distinción no vive acá sino en
-- cada capacidad (ver el campo `inerte` en src/lib/capabilities/types.ts).
--
-- El motivo de esa línea no es timidez: el Operador lee mensajes escritos por
-- clientes del comercio, donde alguien puede esconder instrucciones. Con esta
-- separación, lo peor que consigue un ataque es dejar cosas apagadas que una
-- persona va a ver antes de prenderlas.
--
-- `artifact` guarda qué se construyó, en la forma que la pantalla sabe dibujar
-- (una plantilla, el árbol de una automatización). Sin esto, al recargar el
-- hilo queda el texto y se pierde lo que se vio armarse.
--
-- Idempotente. Se aplica a mano por la Management API.

ALTER TABLE operacion_setup
  ADD COLUMN IF NOT EXISTS auto_build BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE operator_actions
  ADD COLUMN IF NOT EXISTS artifact JSONB;
