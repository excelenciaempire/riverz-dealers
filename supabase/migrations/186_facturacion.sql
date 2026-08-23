-- 186 — Facturación: planes, suscripciones y consumo
--
-- Riverz no tenía NADA de esto. Ni tabla de planes, ni suscripción por cuenta,
-- ni prueba, ni forma de saber cuánto factura la plataforma. Se podía operar la
-- cuenta de un comercio de punta a punta y no había dónde anotar que ese
-- comercio paga.
--
-- Tres decisiones que explican la forma:
--
-- 1. **El precio se edita, no se despliega.** Los planes son filas y no
--    constantes en el código: cambiar el precio o lo incluido es un formulario
--    en /admin, no un deploy. En una etapa donde el precio todavía se está
--    descubriendo, tenerlo compilado significa que cada prueba cuesta un
--    despliegue.
--
-- 2. **Cada cuenta puede tener su propio trato.** Al principio se le instala
--    gratis a algunos comercios, y a otros se les hace un precio distinto. Eso
--    NO se modela apagando la facturación: se modela con `cortesia` y con las
--    tres columnas `*_override`, para que el panel de negocio siga contando
--    bien —una cuenta de cortesía vale 0 y se ve como tal— en vez de quedar
--    afuera del cuadro.
--
-- 3. **El consumo se acumula por día.** Un panel que cuente conversaciones
--    barriendo `ai_replies` cada vez no escala, y para facturar hace falta un
--    número que no cambie cuando alguien borra una conversación vieja. La
--    acumulación diaria es el registro; el resto son sumas sobre ella.
--
-- Sin RLS: todo esto lo lee y lo escribe la llave de servicio, desde /admin o
-- desde el webhook de Stripe. Idempotente.

-- ── Planes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  -- En centavos y entero: nunca en float. Un precio que se guarda como 299.0
  -- termina en 298.99999 después de dos multiplicaciones.
  precio_centavos INT NOT NULL DEFAULT 0,
  moneda        TEXT NOT NULL DEFAULT 'usd',
  -- Lo incluido y lo que cuesta pasarse. La unidad es la CONVERSACIÓN atendida
  -- por IA en el mes: es lo que sigue al costo real de Anthropic y es lo único
  -- que se le puede explicar a un comercio sin hablar de tokens.
  incluidas     INT NOT NULL DEFAULT 0,
  excedente_centavos INT NOT NULL DEFAULT 0,
  -- Del lado de Stripe. Se pega a mano desde /admin: crear precios por API
  -- desde el panel sería poder romper la facturación con un click.
  stripe_price_id TEXT,
  stripe_price_excedente_id TEXT,
  orden         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Qué paga cada cuenta ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  workspace_id  UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id       UUID REFERENCES billing_plans(id) ON DELETE SET NULL,
  -- `cortesia` es el caso real de esta etapa: se lo instalamos gratis y no
  -- vence. No es lo mismo que `prueba` (vence) ni que `cancelada` (se fue).
  estado        TEXT NOT NULL DEFAULT 'prueba'
                CHECK (estado IN ('prueba', 'activa', 'vencida', 'cancelada', 'cortesia')),
  prueba_hasta  TIMESTAMPTZ,
  periodo_desde TIMESTAMPTZ,
  periodo_hasta TIMESTAMPTZ,
  -- El trato de ESTA cuenta, cuando difiere del plan. NULL = lo que diga el
  -- plan. Vive acá y no en un plan a medida por comercio para que el panel de
  -- negocio pueda decir "estos 8 están en Pro" y aparte "3 con precio propio".
  precio_centavos_override INT,
  incluidas_override INT,
  excedente_centavos_override INT,
  -- Por qué el trato es distinto. Sin esto, en seis meses nadie se acuerda.
  nota          TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  cancelar_al_final BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_subscriptions_estado_idx
  ON workspace_subscriptions (estado);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_stripe_sub_idx
  ON workspace_subscriptions (stripe_subscription_id);

-- ── Consumo, acumulado por día ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_usage_daily (
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dia           DATE NOT NULL,
  -- La unidad que se factura: conversaciones distintas con al menos una
  -- respuesta de IA ese día.
  conversaciones INT NOT NULL DEFAULT 0,
  respuestas    INT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  -- Lo que nos costó a NOSOTROS ese día. Es la otra mitad del margen y no se
  -- puede recalcular después: las tarifas cambian.
  costo_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, dia)
);

CREATE INDEX IF NOT EXISTS billing_usage_daily_dia_idx
  ON billing_usage_daily (dia DESC);

-- ── El plan con el que arranca todo ────────────────────────────────────────
-- Se siembra una sola vez. A partir de acá se edita desde /admin.
INSERT INTO billing_plans (slug, nombre, precio_centavos, moneda, incluidas, excedente_centavos, orden)
VALUES ('pro', 'Pro', 29900, 'usd', 2000, 20, 1)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE billing_plans IS
  'Los planes, editables desde /admin. El precio NO vive en el código: en esta etapa cada prueba de precio costaría un despliegue.';
COMMENT ON COLUMN workspace_subscriptions.estado IS
  'cortesia = se lo instalamos gratis y no vence. Cuenta como cliente en el panel de negocio, con MRR 0.';
