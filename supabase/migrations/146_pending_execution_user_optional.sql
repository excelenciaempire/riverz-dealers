-- Una espera que no se puede encolar deja el flujo dormido para siempre.
--
-- `automation_pending_executions.user_id` era NOT NULL. Las corridas que
-- dispara el cron no siempre tienen un usuario detrás (el disparador es un
-- carrito de Shopify o un pago rechazado, no un clic de alguien), así que el
-- INSERT del paso de espera fallaba y nadie se enteraba: el registro quedaba
-- en "parcial" con la espera anotada, sin fila que reanudar, y el mensaje
-- nunca salía.
--
-- La 053 hizo exactamente esto con automation_logs.user_id por la misma razón.
-- La columna se sigue llenando cuando se puede resolver al dueño del
-- workspace; lo que deja de hacer es tirar abajo la corrida cuando no.

alter table public.automation_pending_executions
  alter column user_id drop not null;
