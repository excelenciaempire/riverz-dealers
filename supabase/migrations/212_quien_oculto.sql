-- QUIÉN OCULTÓ ESTE COMENTARIO
--
-- `messages.is_hidden` era un sí/no sin autor. Tres caminos distintos lo
-- escriben —el filtro de spam de la IA, la barra de moderación de la bandeja y
-- la conciliación con la red cuando alguien lo oculta desde Instagram— y
-- ninguno dejaba rastro. El 2026-08-28, con diez comentarios críticos ocultos
-- en dos días, no había forma de contestar "¿lo ocultó Riverz o lo ocultamos
-- nosotros?" sin adivinar leyendo el código.
--
--   hidden_by       'ia' | 'persona' | 'red'
--   hidden_by_user_id  quién, cuando fue una persona desde la bandeja
--   hidden_reason   por qué lo decidió la IA ('spam'), o nulo
--   hidden_at       cuándo se ocultó (created_at es cuándo lo escribieron)
--
-- Volver a mostrarlo limpia las cuatro: el rastro describe el estado actual,
-- no la historia.

alter table public.messages
  add column if not exists hidden_by text,
  add column if not exists hidden_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists hidden_reason text,
  add column if not exists hidden_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_hidden_by_check'
  ) then
    alter table public.messages
      add constraint messages_hidden_by_check
      check (hidden_by is null or hidden_by in ('ia', 'persona', 'red'));
  end if;
end $$;

comment on column public.messages.hidden_by is
  'Quién ocultó el comentario: ia (filtro de spam), persona (bandeja) o red (Instagram/Facebook/TikTok).';
