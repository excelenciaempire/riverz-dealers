-- Que un fallo de una tarde no se coma la atribución de la venta.
--
-- La 197 dejó el índice `conversion_events_pendientes` "para el reintento" y no
-- había reintento: lo que fallaba se quedaba fallado para siempre. Y falla por
-- cosas que se arreglan solas o en un rato — un 500 de Meta, la red, o un token
-- de la API de Conversiones vencido que el comercio renueva al día siguiente.
-- Sin reintento, cada uno de esos ratos es una venta que el algoritmo nunca
-- supo que ocurrió.

-- 1. Lo que se mandó, tal cual se mandó.
--
-- El reintento NO puede reconstruir el cuerpo: el `_fbc` de la conversación
-- puede haber cambiado, el contacto puede haberse editado, y la hora del evento
-- tiene que seguir siendo la de la VENTA y no la del reintento (Meta atribuye
-- por `event_time`, y estamparlo de nuevo movería la venta de día y de
-- campaña). Guardarlo entero es además lo que le permite al comercio ver qué se
-- envió en su nombre, que era la promesa de la tabla.
alter table conversion_events
  add column if not exists payload jsonb;

comment on column conversion_events.payload is
  'El cuerpo exacto que se le mandó a Meta. Lo reusa el reintento —reconstruirlo movería la hora del evento y la atribución con ella— y es lo que el comercio puede auditar.';

-- 2. Cuántas veces se intentó.
--
-- Con tope: un token ilegible falla igual la vez mil, y reintentar cada quince
-- minutos durante una semana son 672 llamadas inútiles por evento. Cinco
-- intentos con espera creciente (15 min, 30 min, 1 h, 2 h, 4 h) cubren tanto el
-- bache de red como el token que alguien arregla en la mañana.
alter table conversion_events
  add column if not exists intentos smallint not null default 0;

-- 3. El índice de pendientes, ahora con el tope adentro.
--
-- Sin `intentos` en la condición, el barrido seguía leyendo para siempre las
-- filas ya rendidas.
drop index if exists conversion_events_pendientes;

create index if not exists conversion_events_pendientes
  on conversion_events (created_at)
  where status <> 'enviado' and intentos < 5;
