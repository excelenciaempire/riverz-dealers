-- El preview de la bandeja tiene que decir si ese comentario está oculto.
--
-- La burbuja ya lo dice, pero la lista no: un comentario ocultado en Instagram
-- o Facebook se ve en el preview igual que cualquier otro, así que hay que
-- abrir la conversación para enterarse. Justo al revés de para qué existe una
-- lista.
--
-- El preview se dibuja con las columnas desnormalizadas de `conversations`, y
-- `last_message_text` se escribe desde una docena de lugares del código. Sumar
-- la nueva a cada uno de ellos garantiza que alguno se olvide, y peor: el
-- estado de oculto NO cambia cuando llega un mensaje, cambia cuando alguien
-- oculta uno que ya estaba — un momento en el que nadie toca `last_message_*`.
--
-- Por eso va en un disparador, con la misma forma que el del tick de entrega
-- (migración 103): se despierta al insertar un mensaje y al cambiar `is_hidden`,
-- y sólo hace algo si quien cambió es el ÚLTIMO mensaje de la conversación.
alter table public.conversations
  add column if not exists last_message_hidden boolean not null default false;

create or replace function public.sync_conversation_last_message_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Mismo guard que el tick: ocultar un comentario viejo no cambia lo que
  -- muestra el preview, que habla del último.
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
  set last_message_hidden = coalesce(new.is_hidden, false)
  where c.id = new.conversation_id
    and c.last_message_hidden is distinct from coalesce(new.is_hidden, false);

  return new;
end;
$$;

drop trigger if exists trg_conversation_last_message_hidden on public.messages;
create trigger trg_conversation_last_message_hidden
after insert or update of is_hidden on public.messages
for each row
execute function public.sync_conversation_last_message_hidden();

-- Los que ya estaban ocultos antes de esto.
update public.conversations c
set last_message_hidden = coalesce(m.is_hidden, false)
from (
  select distinct on (conversation_id) conversation_id, is_hidden
  from public.messages
  order by conversation_id, created_at desc, id desc
) m
where m.conversation_id = c.id
  and c.last_message_hidden is distinct from coalesce(m.is_hidden, false);
