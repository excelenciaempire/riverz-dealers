-- Campo dinámico declarado por cada variable {{n}} de una plantilla.
--
-- El editor de plantillas deja elegir QUÉ representa cada {{n}} (nombre del
-- cliente, número de seguimiento, link del carrito...). Guardar ese mapeo hace
-- que las automatizaciones que usen la plantilla lo llenen SOLAS, sin volver a
-- mapear a mano. Forma: { "1": "customer_name", "2": "tracking_number" }.
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS variable_fields JSONB;
