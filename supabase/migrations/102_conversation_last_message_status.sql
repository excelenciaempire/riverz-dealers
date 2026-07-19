-- Tick estilo WhatsApp en el preview de la bandeja.
--
-- Para mostrar en la LISTA de chats el estado de entrega del último mensaje
-- cuando lo mandamos nosotros (✓ enviado, ✓✓ entregado, ✓✓ azul leído, ✗
-- fallido), la conversación necesita conocer el estado del último mensaje. Se
-- mantiene por trigger desde `messages` para cubrir TODOS los caminos de envío
-- (bandeja, IA, flujos, broadcasts, echoes) y los webhooks de estado, sin tener
-- que tocar cada uno. NULL cuando el último mensaje es del cliente (sin tick).
alter table public.conversations
  add column if not exists last_message_status text;

comment on column public.conversations.last_message_status is
  'Estado de entrega del ÚLTIMO mensaje si es SALIENTE (sent/delivered/read/failed), o NULL si el último es del cliente. Mantiene el tick estilo WhatsApp en el preview de la bandeja. Sincronizado por trigger desde messages.';

create or replace function public.sync_conversation_last_message_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo tocar la conversación si NEW es (al menos) tan reciente como su último
  -- mensaje: así un mensaje viejo (backfill) o un webhook de estado de un
  -- mensaje ya superado no pisa el estado del mensaje más nuevo.
  update public.conversations c
  set last_message_status =
        case when new.sender_type = 'customer' then null else new.status end
  where c.id = new.conversation_id
    and (c.last_message_at is null or new.created_at >= c.last_message_at);
  return new;
end;
$$;

drop trigger if exists trg_conversation_last_message_status on public.messages;
create trigger trg_conversation_last_message_status
after insert or update of status on public.messages
for each row
execute function public.sync_conversation_last_message_status();

-- Backfill: fijar el estado del último mensaje de cada conversación existente
-- (solo cuando ese último mensaje es saliente; si es del cliente queda NULL).
update public.conversations c
set last_message_status = m.status
from (
  select distinct on (conversation_id) conversation_id, status, sender_type
  from public.messages
  order by conversation_id, created_at desc
) m
where m.conversation_id = c.id
  and m.sender_type <> 'customer';
