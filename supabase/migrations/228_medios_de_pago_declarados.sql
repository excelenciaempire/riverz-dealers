-- ============================================================
-- 228 - Con que se puede pagar: una lista, no una adivinanza
-- ============================================================
--
-- "Con que puedo pagar" era la pregunta mas comun sin respuesta. El agente
-- sabia mandar a la caja pero no sabia decir con QUE se paga en ella, asi que
-- escalaba — o peor, lo deducia. El 2026-08-29 le confirmo "pago contra
-- entrega" a la clienta de un comercio que no lo acepta.
--
-- El parche del mismo dia (migracion 225) agrego `acepta_contraentrega`, que
-- resolvia UN medio de pago de los seis. Esto lo reemplaza por la lista
-- entera, que es la pregunta que el comercio de verdad tiene que contestar
-- cuando crea su asistente, y una sola vez.
--
--   NULL          no lo declaro. El agente no nombra ninguno y no confirma
--                 contra entrega: pasa a una persona. Es el estado de todo
--                 asistente recien creado, y es el lado seguro.
--   []            lo declaro y no hay ninguno cargado (raro, pero no es NULL:
--                 significa "ya lo mire").
--   ['tarjeta',…] estos y solo estos.
--
-- El contra entrega es UNO de la lista y no un campo aparte: son la misma
-- pregunta, y separarlos daba dos lugares donde decir lo mismo.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS medios_pago JSONB;

COMMENT ON COLUMN ai_agents.medios_pago IS
  'Con que se puede pagar, en las claves de MEDIOS_PAGO (lib/ai/medios-pago.ts). NULL = el comercio no lo declaro: el agente no nombra ninguno y escala el contra entrega.';

-- Lo que ya se habia declarado con la columna anterior no se pierde.
UPDATE ai_agents
   SET medios_pago = CASE
         WHEN acepta_contraentrega IS TRUE  THEN '["contraentrega"]'::jsonb
         WHEN acepta_contraentrega IS FALSE THEN '[]'::jsonb
       END
 WHERE acepta_contraentrega IS NOT NULL
   AND medios_pago IS NULL;

ALTER TABLE ai_agents DROP COLUMN IF EXISTS acepta_contraentrega;
