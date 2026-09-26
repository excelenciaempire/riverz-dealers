/**
 * El historial inicial de un buzón de correo (Gmail, Outlook, Zoho).
 *
 * Al conectar un buzón se importan los últimos 90 días COMPLETOS —lo que
 * escribió el cliente y lo que contestó el comercio— para que el agente
 * tenga conversaciones reales de las que aprender. Antes cada proveedor
 * miraba 7 días y sólo la bandeja: el archivo, los enviados (Zoho) y todo lo
 * anterior a la semana quedaban afuera para siempre.
 *
 * El historial es un recorrido APARTE del de todos los días, con su propio
 * cursor. Así no frena el correo en vivo mientras se importa (en Zoho no hay
 * push: si el historial ocupara el recorrido, el correo nuevo esperaría
 * horas) y el recorrido en vivo nunca tiene que ensancharse a 90 días.
 *
 * Se hace UNA vez por conexión: `email_backfill_done` es la marca. El tramo
 * [desde, hasta) se congela en la primera corrida (`email_backfill_since` /
 * `email_backfill_until`) para que los cursores de página sigan valiendo
 * entre corridas; lo posterior a `hasta` es trabajo del recorrido en vivo.
 */

export const DIAS_DE_HISTORIAL = 90;
const DIA_MS = 86_400_000;

export interface PlanDeHistorial {
  /** true mientras falta terminar de importar el historial. */
  pendiente: boolean;
  /** Tramo del historial: [desdeMs, hastaMs). */
  desdeMs: number;
  hastaMs: number;
  /** Lo que se guarda en config para que el tramo no se corra. */
  config: Record<string, unknown>;
}

function fecha(valor: unknown): number | null {
  if (typeof valor !== 'string' || !valor) return null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

export function planDeHistorial(
  config: Record<string, unknown> | null | undefined,
  ahora = Date.now(),
): PlanDeHistorial {
  const cfg = config ?? {};
  if (cfg.email_backfill_done === true) {
    return { pendiente: false, desdeMs: ahora, hastaMs: ahora, config: {} };
  }
  const hasta = fecha(cfg.email_backfill_until) ?? ahora;
  const guardado = fecha(cfg.email_backfill_since);
  // Un tramo guardado al revés (config tocada a mano) se rehace desde `hasta`.
  const desde =
    guardado != null && guardado < hasta
      ? guardado
      : hasta - DIAS_DE_HISTORIAL * DIA_MS;
  return {
    pendiente: true,
    desdeMs: desde,
    hastaMs: hasta,
    config: {
      email_backfill_since: new Date(desde).toISOString(),
      email_backfill_until: new Date(hasta).toISOString(),
    },
  };
}

/**
 * Lo que se guarda al final de la corrida. Al terminar se pone la marca y se
 * limpian los cursores propios del proveedor (`temporales`).
 */
export function estadoDeHistorial(
  plan: PlanDeHistorial,
  terminado: boolean,
  temporales: string[] = [],
): Record<string, unknown> {
  if (!plan.pendiente) return {};
  if (!terminado) return plan.config;
  return {
    ...plan.config,
    email_backfill_done: true,
    ...Object.fromEntries(temporales.map((clave) => [clave, null])),
  };
}

/**
 * Desde dónde mira el recorrido en vivo cuando todavía no tiene cursor.
 * Con historial pendiente basta un día antes del corte (lo anterior lo trae
 * el historial); sin historial, la semana de siempre.
 */
export function desdeSinCursor(plan: PlanDeHistorial, ahora = Date.now()): number {
  return plan.pendiente ? plan.hastaMs - DIA_MS : ahora - 7 * DIA_MS;
}

/** Un cursor ISO guardado en config, o null si falta o es ilegible. */
export function cursorGuardado(valor: unknown): number | null {
  return fecha(valor);
}
