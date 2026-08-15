/**
 * Puente entre el catálogo de trabajos y el panel de plataforma.
 *
 * Acá vivía un SEGUNDO catálogo (`CRON_SCHEDULES`) que se autodocumentaba como
 * "mantener en sincronía con render.yaml" — un archivo que hace rato no declara
 * ningún cron, porque los dispara el reloj interno desde `lib/cron/schedule.ts`.
 * Los dos se separaron, con estas consecuencias medidas:
 *
 *   - `klaviyo-sync` e `issues-alert` corrían en producción y no tenían fila;
 *   - los cuatro sub-trabajos (`comment-sync-reconcile`, `mercadolibre-orders`,
 *     `mercadolibre-catalog`, `ml-reviews`) tampoco;
 *   - `automations`, `flows-retries` y `flows-cron` figuraban "no declarado" con
 *     `schedule: null`, y como el umbral de atraso no se calcula sin schedule,
 *     el panel NUNCA los podía pintar en rojo si se morían;
 *   - `outlook-poll` toleraba 15 minutos de atraso en vez de 6.
 *
 * Ahora hay un solo catálogo. Este módulo sólo lo re-exporta con la forma que
 * espera la pantalla.
 */
import { SCHEDULED_JOBS, isStale, expectedIntervalMs } from '@/lib/cron/schedule';

export { isStale, expectedIntervalMs };

export interface CronSpec {
  /** Clave en `cron_runs.name`. */
  name: string;
  /** Ruta que se golpea. */
  path: string;
  /** Expresión cron en UTC. */
  schedule: string;
  /** Clave i18n de qué hace. */
  whatKey: string;
  /** Nombre del trabajo que lo dispara, si es un sub-trabajo. */
  parent?: string;
}

/** El catálogo, tal cual, para la pantalla de operación. */
export function cronCatalog(): CronSpec[] {
  return SCHEDULED_JOBS.map((j) => ({
    name: j.name,
    path: j.path,
    schedule: j.schedule,
    whatKey: j.whatKey,
    parent: j.parent,
  }));
}
