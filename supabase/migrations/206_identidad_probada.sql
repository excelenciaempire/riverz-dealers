-- ============================================================
-- 206 — De dónde salió el teléfono, y de dónde el correo
-- ============================================================
--
-- La unión de contactos entre canales (migración 050) junta dos fichas cuando
-- comparten teléfono o correo. El problema es que la columna no dice de dónde
-- salió ese dato, y hay dos clases que no valen lo mismo:
--
--   PROBADO   el identificador ES la identidad del canal (el teléfono de
--             WhatsApp, la casilla de un correo), o vino de una transacción
--             real: un pedido con dirección de entrega, el webhook de la
--             tienda, un cobro. Del otro lado hay algo que va a llegar a algún
--             lado, o un comercio que lo va a mirar.
--
--   AFIRMADO  alguien lo escribió en un chat y nadie lo verificó.
--
-- Unir sobre un dato afirmado es una toma de cuenta en dos pasos: pongo el
-- correo de otra clienta en el chat y me quedo con su ficha, sus pedidos y su
-- dirección. Por eso `/api/widget/identify` tenía la unión apagada entera —
-- correcto, pero grueso: un cliente de verdad que da su correo en el chat y ya
-- había comprado por WhatsApp quedaba partido en dos fichas para siempre.
--
-- Con el origen anotado, el dato afirmado se guarda igual (sirve para
-- escribirle) y la unión espera a que ese mismo correo aparezca respaldado por
-- algo. Deja de ser "unir o no unir" y pasa a ser "unir cuando se pueda
-- probar".
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone_origen TEXT,
  ADD COLUMN IF NOT EXISTS email_origen TEXT;

COMMENT ON COLUMN contacts.phone_origen IS
  'De dónde salió el teléfono: canal | pedido | tienda | pago | manual | afirmado. Sólo los cuatro primeros y "manual" habilitan la unión entre canales (lib/contacts/dedupe.ts).';

COMMENT ON COLUMN contacts.email_origen IS
  'Ídem para el correo. NULL = anterior a esta migración, origen desconocido.';

-- NULL a propósito para las filas viejas.
--
-- Poner un valor por omisión seria mentir: no sabemos de dónde salió el
-- teléfono de un contacto de hace seis meses. `dedupe.ts` trata NULL como
-- HEREDADO y lo deja unir, porque esas uniones ya existen y romperlas de golpe
-- partiría clientes reales que hoy se ven bien. Lo nuevo sí se anota.

-- ── Deshacer una unión, y que no se rehaga sola ──
--
-- Hasta ahora no había forma de separar dos contactos mal unidos: se podía
-- poner `unified_contact_id` en NULL a mano, y el siguiente mensaje entrante
-- los volvía a juntar, porque el teléfono seguía coincidiendo. Sin un freno,
-- "deshacer" no existe.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS union_bloqueada BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN contacts.union_bloqueada IS
  'Alguien separó este contacto a mano. La unión automática lo saltea para siempre. Se levanta desde la ficha del contacto.';

-- La unión se consulta por estas dos columnas en cada mensaje entrante.
CREATE INDEX IF NOT EXISTS contacts_union_bloqueada
  ON contacts (workspace_id)
  WHERE union_bloqueada;
