-- ============================================================
-- 225 - El contra entrega deja de ser un secreto escrito a mano
-- ============================================================
--
-- El 2026-08-29 la IA le confirmo "pago contra entrega" a una clienta de un
-- comercio que NO lo acepta. Se arreglo sacando el supuesto del prompt: ahora
-- el contra entrega solo se toma si figura en las reglas del negocio o en la
-- ficha del producto.
--
-- Pero eso dejo al comercio que SI lo acepta —que son muchos— teniendo que
-- descubrir que hay que escribirse una regla a mano para habilitar algo que
-- es una casilla. Nadie adivina eso. El resultado practico era el contrario
-- del deseado: la IA escalaba cada pedido contra entrega de un comercio que
-- vive de eso.
--
-- Ahora es un dato del agente, al lado de "como se cobra". Arranca en NULL
-- —"no lo dijo"— y NULL se comporta como antes: no se ofrece y no se
-- confirma. Solo el que marca la casilla lo habilita.
--
-- Aplicada A MANO por la Management API (no corre en el deploy de Render).
-- ============================================================

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS acepta_contraentrega BOOLEAN;

COMMENT ON COLUMN ai_agents.acepta_contraentrega IS
  'true = el comercio cobra al recibir y el agente puede tomar el pedido asi; false = no lo acepta y lo dice; NULL = no lo declaro, el agente no lo ofrece ni lo confirma (pasa a una persona).';
