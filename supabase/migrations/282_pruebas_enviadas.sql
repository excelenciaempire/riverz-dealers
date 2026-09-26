-- La prueba que el comercio le manda al equipo de Riverz ("Enviar al equipo").
-- Las mejoras las propone y aprueba el equipo desde el panel de plataforma;
-- el comercio sólo comenta y envía.
alter table public.ai_test_sessions
  add column if not exists enviada_at timestamptz;

create index if not exists ai_test_sessions_enviadas_idx
  on public.ai_test_sessions (workspace_id, enviada_at desc)
  where enviada_at is not null;
