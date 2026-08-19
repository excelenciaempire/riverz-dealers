-- 164 — Rol y permisos por acción en los agentes
--
-- Hasta acá un comercio podía tener UN agente activo por canal. La "flota" se
-- lograba de costado, con `product_scope='specific'`: dos agentes convivían en
-- WhatsApp sólo si atendían productos distintos. Eso alcanza para separar
-- catálogos y no sirve para lo que hace falta, que es separar TRABAJOS: uno que
-- vende y otro que atiende postventa, sobre el mismo producto y el mismo canal.
--
-- `role` es metadata de arbitraje, no un interruptor de capacidades.
--
-- Esa distinción es la lección de las migraciones 131 y 133: `is_super` se creó
-- como un toggle de "agente completo" y se borró dos migraciones después,
-- porque lo que se quería no era un modo sino una conducta. Acá el rol NO
-- habilita ni deshabilita nada — sólo decide a quién le toca el mensaje. Lo que
-- se puede hacer vive en `permissions`, que es explícito y granular.
--
-- `permissions` NULL significa "usá las columnas viejas". No se migra ningún
-- dato: los agentes que ya existen siguen gobernados por `puede_crear_pedidos`
-- y por si tienen Shopify conectado, exactamente como hasta ahora. Un agente
-- nuevo nace con su preset y los dos caminos conviven.
--
-- Idempotente. Se aplica a mano por la Management API.

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agents_role_check'
  ) THEN
    ALTER TABLE ai_agents
      ADD CONSTRAINT ai_agents_role_check
      CHECK (role IN ('general', 'ventas', 'postventa', 'recuperacion', 'retencion'));
  END IF;
END $$;

-- Claves esperadas: crear_pedidos, crear_checkout, registrar_pago,
-- editar_pedido, escalar_llamada, enviar_proactivo. Se guarda como jsonb y no
-- como seis columnas porque la lista va a crecer con las acciones de postventa
-- (cancelar, reembolsar, cambiar dirección) y cada una sería otra migración.
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS permissions JSONB;

-- El arbitraje entre agentes del mismo canal ordena por rol y prioridad.
CREATE INDEX IF NOT EXISTS ai_agents_ws_role_idx
  ON ai_agents (workspace_id, role)
  WHERE is_active = true AND deleted_at IS NULL;
