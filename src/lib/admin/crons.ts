/**
 * Catálogo de trabajos de fondo.
 *
 * `cron_runs` solo sabe qué corrió; no sabe qué DEBERÍA correr. Sin esa
 * segunda mitad, un cron que nunca se declaró en `render.yaml` (o que dejó de
 * declararse) es invisible: no aparece en la tabla porque nunca escribió una
 * fila. Este catálogo es la lista esperada, y `/admin/operacion` compara ambas.
 *
 * `name` es la clave que el route handler escribe en `cron_runs.name`.
 * `schedule` es null cuando el handler existe pero NO está declarado como
 * Render Cron Service — es decir, hoy nadie lo dispara.
 *
 * Mantener en sincronía con `render.yaml` al agregar o quitar un cron.
 */

export interface CronSpec {
  /** Clave en cron_runs.name */
  name: string;
  /** Ruta que se golpea */
  path: string;
  /** Expresión cron declarada en render.yaml, o null si no está declarado */
  schedule: string | null;
  /** Qué hace, en una línea */
  what: string;
}

export const CRON_SCHEDULES: CronSpec[] = [
  // ── cada minuto ──
  { name: 'flows-resume', path: 'api/cron/flows-resume', schedule: '* * * * *', what: 'Reanuda flujos en espera' },
  { name: 'broadcasts', path: 'api/broadcasts/cron', schedule: '* * * * *', what: 'Envía campañas programadas' },
  { name: 'voice-calls', path: 'api/cron/voice-calls', schedule: '* * * * *', what: 'Despacha llamadas en cola' },
  { name: 'voice-campaign-run', path: 'api/cron/voice-campaign-run', schedule: '* * * * *', what: 'Avanza campañas de voz' },

  // ── minutos ──
  { name: 'instagram-agent', path: 'api/cron/instagram-agent', schedule: '*/2 * * * *', what: 'Motor de DMs proactivos de Instagram' },
  { name: 'gmail-poll', path: 'api/cron/gmail-poll', schedule: '*/5 * * * *', what: 'Sondea buzones de Gmail' },
  { name: 'outlook-poll', path: 'api/cron/outlook-poll', schedule: '*/5 * * * *', what: 'Sondea buzones de Outlook' },
  { name: 'instagram-external-enrich', path: 'api/cron/instagram-external-enrich', schedule: '*/10 * * * *', what: 'Enriquece perfiles públicos de Instagram' },
  { name: 'contacts-sync', path: 'api/cron/contacts-sync', schedule: '*/10 * * * *', what: 'Completa datos de contactos desde Shopify' },
  { name: 'comment-sync', path: 'api/cron/comment-sync', schedule: '*/10 * * * *', what: 'Sincroniza comentarios de Facebook e Instagram' },
  { name: 'comment-sync-reconcile', path: 'api/cron/comment-sync', schedule: '*/10 * * * *', what: 'Reconcilia borrados/ocultos de comentarios' },
  { name: 'tiktok-comments', path: 'api/cron/tiktok-comments', schedule: '*/10 * * * *', what: 'Única vía de entrada de comentarios de TikTok' },
  { name: 'ai-followups', path: 'api/cron/ai-followups', schedule: '*/30 * * * *', what: 'Seguimientos de la IA cuando el cliente calla' },
  { name: 'delivery-watchdog', path: 'api/cron/delivery-watchdog', schedule: '*/30 * * * *', what: 'Marca envíos sin confirmar' },

  // ── horas ──
  { name: 'shopify-cart-recovery', path: 'api/cron/shopify-cart-recovery', schedule: '0 * * * *', what: 'Recupera carritos abandonados' },
  { name: 'tiendanube-checkouts', path: 'api/cron/tiendanube-checkouts', schedule: '15 * * * *', what: 'Descubre carritos abandonados de Tiendanube' },
  { name: 'shopify-feedback', path: 'api/cron/shopify-feedback', schedule: '30 * * * *', what: 'Pide opinión tras la entrega' },
  { name: 'meta-contact-names', path: 'api/cron/meta-contact-names', schedule: '0 */6 * * *', what: 'Completa nombres de contactos de Meta' },
  { name: 'meta-webhook-subscriptions', path: 'api/cron/meta-webhook-subscriptions', schedule: '0 */6 * * *', what: 'Reaplica suscripciones de webhooks de Meta' },
  { name: 'gmail-watch', path: 'api/cron/gmail-watch', schedule: '0 */12 * * *', what: 'Renueva la suscripción push de Gmail' },
  { name: 'outlook-watch', path: 'api/cron/outlook-watch', schedule: '0 */12 * * *', what: 'Renueva la suscripción push de Outlook' },

  // ── diarios ──
  { name: 'pii-purge', path: 'api/cron/pii-purge', schedule: '0 3 * * *', what: 'Borra datos personales de comercios eliminados' },
  { name: 'meta-dm-backfill', path: 'api/cron/meta-dm-backfill', schedule: '0 5 * * *', what: 'Reingesta historial de mensajes de Meta' },
  { name: 'meta-token-refresh', path: 'api/cron/meta-token-refresh', schedule: '0 6 * * *', what: 'Renueva el token de Facebook Login' },
  { name: 'reengagement', path: 'api/cron/reengagement', schedule: '0 14 * * *', what: 'Reengancha compradores inactivos' },

  // ── sin entrada en render.yaml ──
  // Ojo: "no declarado" no siempre es "no corre". `automations` reporta ~1400
  // corridas cada 24 h, o sea que algo externo al blueprint lo dispara cada
  // minuto. Por eso la pantalla cruza el catálogo con `cron_runs` en vez de
  // dar por muerto todo lo que falte acá.
  { name: 'mercadolibre-poll', path: 'api/cron/mercadolibre-poll', schedule: null, what: 'Preguntas de Mercado Libre (absorbido por el cron mercadolibre)' },
  { name: 'mercadolibre', path: 'api/cron/mercadolibre', schedule: '*/5 * * * *', what: 'Todo Mercado Libre: preguntas siempre; pedidos/envios/reclamos ~15 min; catalogo y opiniones ~60 min' },
  { name: 'automations', path: 'api/automations/cron', schedule: null, what: 'Drena pasos de espera de automatizaciones' },
  { name: 'flows-cron', path: 'api/flows/cron', schedule: null, what: 'Barre flujos vencidos por tiempo' },
  { name: 'flows-retries', path: 'api/flows/retries/cron', schedule: null, what: 'Reintenta ejecuciones de flujo fallidas' },
];

/** Los que tienen handler pero no están declarados en render.yaml. */
export function undeclaredCrons(): CronSpec[] {
  return CRON_SCHEDULES.filter((c) => c.schedule === null);
}

/** Milisegundos que deberían pasar, como mucho, entre dos corridas. */
export function expectedIntervalMs(schedule: string | null): number | null {
  if (!schedule) return null;
  const [min, hour] = schedule.split(' ');
  if (min === '*') return 60_000;
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin) return Number(everyMin[1]) * 60_000;
  const everyHour = hour?.match(/^\*\/(\d+)$/);
  if (everyHour) return Number(everyHour[1]) * 3_600_000;
  if (hour === '*') return 3_600_000;
  return 24 * 3_600_000;
}

/**
 * ¿Este cron lleva demasiado sin reportar? Se da un margen de 3 intervalos
 * antes de gritar, para no marcar en rojo por un retraso normal de Render.
 */
export function isStale(schedule: string | null, lastRunIso: string | null): boolean {
  const interval = expectedIntervalMs(schedule);
  if (!interval) return false;
  if (!lastRunIso) return true;
  return Date.now() - new Date(lastRunIso).getTime() > interval * 3;
}
