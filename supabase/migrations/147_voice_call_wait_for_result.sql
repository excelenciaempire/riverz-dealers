-- El paso "Llamar con IA" encolaba la llamada y seguía al paso siguiente en el
-- acto. La automatización más obvia —"llamar; si no contesta, mandar
-- WhatsApp"— mandaba el WhatsApp mientras el teléfono todavía sonaba, y para
-- que funcionara de verdad había que armar una SEGUNDA automatización con el
-- disparador `voice_call_completed`. Nadie descubre eso solo.
--
-- Ahora el paso puede SUSPENDER la corrida, igual que la espera, y reanudarla
-- cuando la llamada llega a su estado final. Para eso la fila pendiente tiene
-- que poder encontrarse por el id de la llamada, no solo por su hora.

alter table public.automation_pending_executions
  add column if not exists resume_key text;

comment on column public.automation_pending_executions.resume_key is
  'Clave externa que reanuda esta corrida antes de run_at. Hoy: el id de la voice_call que el paso está esperando. run_at queda como red de seguridad.';

-- Reanudar por llamada es una lectura puntual y frecuente (una por llamada
-- terminada), así que va indexada — pero solo sobre lo que todavía espera.
create index if not exists idx_automation_pending_resume_key
  on public.automation_pending_executions (resume_key)
  where status = 'pending' and resume_key is not null;

-- ------------------------------------------------------------------
-- Deriva de esquema: `voice_system_prompt` se lee y escribe en el código
-- (src/lib/voice/context.ts, la API de agentes) y aparece en el GRANT de la
-- 129, pero NINGUNA migración la creó nunca — se aplicó a mano sobre la base
-- de producción. En una base nueva el editor de agentes se rompe al guardar.
-- ------------------------------------------------------------------
alter table public.ai_agents
  add column if not exists voice_system_prompt text;

-- `voice_provider` nació con un CHECK que sólo acepta 'elevenlabs' (migración
-- 113). Desde la 114 el proveedor real de TTS sale de `voice_model_config`
-- (deepgram, fish, cartesia…), así que la columna afirma algo que hace meses
-- dejó de ser cierto y el CHECK sólo espera a que alguien intente escribir el
-- proveedor de verdad. Se suelta la restricción; la columna queda porque el
-- código todavía la lee.
alter table public.ai_agents
  drop constraint if exists ai_agents_voice_provider_check;

comment on column public.ai_agents.voice_provider is
  'Histórico. El proveedor de TTS que se usa en la llamada sale de voice_model_config, no de acá.';
