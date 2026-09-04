-- La operación que cambia según quién atiende vive en el agente de voz.
-- Las políticas comunes (grabación y límite mensual) siguen en la conexión.
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS voice_accepts_inbound BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_transfer_number TEXT;

-- Conserva el comportamiento de las cuentas que ya contestaban entrantes:
-- sus agentes de voz quedan habilitados antes de retirar el switch global.
UPDATE ai_agents AS agent
SET voice_accepts_inbound = true
WHERE agent.voice_enabled = true
  AND EXISTS (
    SELECT 1
    FROM channel_connections AS connection
    WHERE connection.workspace_id = agent.workspace_id
      AND connection.channel = 'voice'
      AND COALESCE((connection.config ->> 'inbound_enabled')::boolean, false) = true
  );

UPDATE ai_agents AS agent
SET voice_transfer_number = NULLIF(connection.config ->> 'transfer_number', '')
FROM channel_connections AS connection
WHERE connection.workspace_id = agent.workspace_id
  AND connection.channel = 'voice'
  AND agent.voice_enabled = true
  AND NULLIF(connection.config ->> 'transfer_number', '') IS NOT NULL
  AND agent.voice_transfer_number IS NULL;

-- La migración 078 usa permisos por columna en ai_agents. Toda columna pública
-- agregada después necesita su grant explícito o una consulta del navegador
-- falla completa con 42501.
GRANT SELECT (
  voice_agent_id,
  voice_accepts_inbound,
  voice_transfer_number
) ON public.ai_agents TO authenticated;
