-- Arregla el tick del preview: se quedaba clavado en ✓ (una raya) para siempre.
--
-- La migración 102 protegía la escritura con `new.created_at >= c.last_message_at`
-- para que un mensaje viejo no pisara el estado del más nuevo. La intención era
-- correcta, pero la comparación es contra el reloj equivocado: los caminos de
-- envío insertan el mensaje (created_at = now() de Postgres, en el INSERT) y
-- RECIÉN DESPUÉS actualizan la conversación con `last_message_at` tomado del
-- reloj de JS. Ese segundo valor siempre queda unos ms por delante.
--
-- Resultado: en el INSERT el guard pasa (compara contra el mensaje anterior) y
-- escribe 'sent'; pero cada UPDATE posterior de status (delivered/read llegando
-- por webhook) evalúa `created_at >= last_message_at` como FALSO y no actualiza
-- nada. El preview se congela en la primera raya aunque messages.status sí avance.
--
-- La condición correcta no es "¿soy más nuevo que un timestamp escrito aparte?"
-- sino "¿soy el último mensaje de esta conversación?" — que es lo que de verdad
-- se quería expresar y no depende de dos relojes distintos.
create or replace function public.sync_conversation_last_message_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo el ÚLTIMO mensaje de la conversación manda sobre el tick del preview.
  -- Un backfill o un webhook de estado de un mensaje ya superado no pisa nada.
  if exists (
    select 1
    from public.messages m
    where m.conversation_id = new.conversation_id
      and (m.created_at > new.created_at
           or (m.created_at = new.created_at and m.id > new.id))
  ) then
    return new;
  end if;

  update public.conversations c
  set last_message_status =
        case when new.sender_type = 'customer' then null else new.status end
  where c.id = new.conversation_id;

  return new;
end;
$$;

-- Re-backfill: la 102 dejó congelado el estado de todas las conversaciones
-- existentes, así que se recalcula con el estado real del último mensaje.
update public.conversations c
set last_message_status =
      case when m.sender_type = 'customer' then null else m.status end
from (
  select distinct on (conversation_id) conversation_id, status, sender_type
  from public.messages
  order by conversation_id, created_at desc, id desc
) m
where m.conversation_id = c.id;
