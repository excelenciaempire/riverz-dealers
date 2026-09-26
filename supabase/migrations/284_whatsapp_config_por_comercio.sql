-- whatsapp_config por comercio, no por dueño.
--
-- La tabla nació con UNIQUE(user_id): un dueño con dos comercios que conectaba
-- WhatsApp en el segundo pisaba el número del primero, y el primero pasaba a
-- enviar automatizaciones, flujos y difusiones por el número del otro. Ahora la
-- clave es el comercio.
alter table public.whatsapp_config drop constraint if exists whatsapp_config_user_id_key;
drop index if exists public.whatsapp_config_user_id_key;
create unique index if not exists uq_whatsapp_config_workspace
  on public.whatsapp_config (workspace_id)
  where workspace_id is not null;
create index if not exists idx_whatsapp_config_user on public.whatsapp_config (user_id);

-- Desconectar WhatsApp en Integraciones solo cambiaba channel_connections: la
-- copia de whatsapp_config seguía "connected" y las automatizaciones seguían
-- enviando por un número desconectado.
create or replace function public.whatsapp_config_sigue_a_la_conexion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel = 'whatsapp'
     and new.status = 'disconnected'
     and old.status is distinct from 'disconnected' then
    update public.whatsapp_config
       set status = 'disconnected', updated_at = now()
     where workspace_id = new.workspace_id
       and phone_number_id = new.external_account_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_config_sigue_a_la_conexion on public.channel_connections;
create trigger trg_whatsapp_config_sigue_a_la_conexion
  after update of status on public.channel_connections
  for each row execute function public.whatsapp_config_sigue_a_la_conexion();
