-- ============================================================
-- 157 — Un solo reloj, aunque haya varias instancias
-- ============================================================
--
-- El reloj de los trabajos de fondo vive en `globalThis` (`lib/cron/scheduler.ts`),
-- o sea POR PROCESO. Con una instancia del servicio eso es correcto y es lo que
-- corre hoy. El día que se escale a dos, cada una dispara todo: campañas
-- duplicadas, carritos duplicados, mensajes duplicados a clientes reales. Y no
-- avisaría nada — sólo aparecerían filas de más en `cron_runs`.
--
-- Ya pasó una versión de esto: medido en prod el 2026-08-04, dos copias del
-- módulo dentro del MISMO proceso tenían cada una su guard y los trabajos de
-- cada minuto se dispararon 2,7 veces por minuto durante 17 horas.
--
-- Esta función es el arreglo del caso entre procesos: quien quiere disparar el
-- minuto pide el turno, y la base concede uno solo. Se toma por MINUTO y no
-- como lock permanente a propósito: si la instancia que lo tenía se muere, el
-- minuto siguiente lo toma otra sin que nadie tenga que soltar nada.
--
-- Idempotente. Se aplica a mano por la Management API.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scheduler_ticks (
  minute     TIMESTAMPTZ PRIMARY KEY,
  holder     TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduler_ticks ENABLE ROW LEVEL SECURITY;

/**
 * ¿Le toca a esta instancia disparar este minuto?
 *
 * El INSERT contra la clave primaria es lo que decide: la primera instancia que
 * llega se lo queda y las demás reciben `false`. No hay ventana entre "mirar" y
 * "tomar" porque son la misma operación.
 */
CREATE OR REPLACE FUNCTION claim_scheduler_tick(p_minute TIMESTAMPTZ, p_holder TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed BOOLEAN;
BEGIN
  INSERT INTO scheduler_ticks (minute, holder)
  VALUES (date_trunc('minute', p_minute), p_holder)
  ON CONFLICT (minute) DO NOTHING;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  -- Limpieza oportunista: la tabla es un registro de turnos, no un historial.
  -- Una fila por minuto son ~43.000 al mes, así que se barre lo viejo acá
  -- mismo en vez de sumar otro trabajo programado que también habría que
  -- vigilar. Sólo de vez en cuando, para no borrar en cada tick.
  IF v_claimed AND random() < 0.01 THEN
    DELETE FROM scheduler_ticks WHERE minute < now() - interval '2 hours';
  END IF;

  RETURN v_claimed;
END;
$$;

REVOKE ALL ON FUNCTION claim_scheduler_tick(timestamptz, text) FROM PUBLIC, anon, authenticated;
