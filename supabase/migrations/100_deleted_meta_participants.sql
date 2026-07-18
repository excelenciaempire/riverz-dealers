-- Supresión de re-ingesta para participantes Meta borrados.
--
-- El backfill de DMs (api/cron/meta-dm-backfill) descubre hilos que el comercio
-- inició desde la app nativa y crea el contacto/conversación (createIfMissing).
-- Pero un contacto borrado por GDPR (api/meta/data-deletion) o a mano es un
-- HARD delete que cascadea la conversación y los mensajes: no queda ninguna
-- fila que impida recrearlo, así que el descubrimiento lo revivía cada 6 h
-- (violando la solicitud de borrado). Esta tabla recuerda SOLO el id opaco de
-- Meta (PSID/IGSID) — sin PII — para no volver a crearlo.
create table if not exists public.deleted_meta_participants (
  channel text not null,
  external_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (channel, external_id)
);

comment on table public.deleted_meta_participants is
  'Lista de supresión: participantes Meta (PSID/IGSID) borrados por GDPR/data-deletion o manualmente. Consultada por meta-dm-backfill para no re-crear el contacto. Solo el id opaco de Meta, sin PII.';

-- Solo el service role (supabaseAdmin, que bypassa RLS) escribe/lee esto; RLS
-- sin policies deja la tabla inaccesible para anon/authenticated.
alter table public.deleted_meta_participants enable row level security;
