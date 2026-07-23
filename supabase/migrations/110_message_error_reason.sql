-- Motivo del fallo de un mensaje saliente.
--
-- messages.status guardaba 'failed' pero NO por qué. Meta manda el motivo real
-- (código + descripción) en el webhook de estados; sin guardarlo, el comercio
-- ve una raya de error sin explicación. Esta columna lo persiste para mostrarlo
-- en la burbuja.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_reason TEXT;
