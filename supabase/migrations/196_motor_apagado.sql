-- 196 — El motor, aparte de la suspensión
--
-- Ya existía un interruptor por cuenta: `suspended_at` (162). Hace dos cosas a
-- la vez —deja la cuenta muda hacia afuera Y le cierra el panel al comercio—
-- porque nació para dar de baja a quien no paga.
--
-- Para instalar hace falta la mitad de eso. El paso 4 de la instalación es
-- justo el estado en el que la operación ya está armada y el comercio tiene que
-- poder entrar, mirarla y aprobarla ANTES de que salga el primer mensaje.
-- Suspenderlo lo dejaría afuera de la pantalla donde tiene que aprobar.
--
-- Entonces son dos columnas y dos significados:
--
--   suspended_at      → no paga: muda hacia afuera y sin panel.
--   motor_apagado_at  → todavía no aprobó (o alguien lo frenó): muda hacia
--                       afuera, pero entra al panel y ve todo.
--
-- Las dos frenan lo mismo del lado de los envíos. Ninguna borra nada ni corta
-- la ingesta: lo que llegue se sigue guardando, así que encender no deja un
-- agujero en el historial.
--
-- Las cuentas que ya existen quedan con el motor prendido (NULL). El motor se
-- apaga solo cuando la instalación crea la operación, que es el momento en que
-- por primera vez hay algo que podría salir sin que nadie lo haya mirado.
--
-- Idempotente. Se aplica a mano por la Management API.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS motor_apagado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motor_apagado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspaces_motor_apagado
  ON public.workspaces (motor_apagado_at)
  WHERE motor_apagado_at IS NOT NULL;

COMMENT ON COLUMN public.workspaces.motor_apagado_at IS
  'Cuándo se apagó el motor. NULL = anda. Frena todo lo que sale; el comercio sigue entrando al panel.';
COMMENT ON COLUMN public.workspaces.motor_apagado_por IS
  'Quién lo apagó: el propio comercio o alguien del equipo. Se conserva aunque después se encienda.';

-- El panel del comercio necesita saber si su motor está apagado para mostrarle
-- el botón de encender. `motor_apagado_por` queda fuera a propósito, igual que
-- `suspended_reason`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_column_grants
    WHERE table_schema = 'public' AND table_name = 'workspaces'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    LIMIT 1
  ) THEN
    GRANT SELECT (motor_apagado_at) ON public.workspaces TO authenticated;
  END IF;
END $$;
