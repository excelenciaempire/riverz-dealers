/**
 * Inventario de trabajos periódicos, en el repo y no en el dashboard.
 *
 * Antes cada entrada de esta lista era un Render Cron Job. Render cobra un
 * mínimo de 1 USD/mes POR cron job y no tiene plan gratuito para ese tipo de
 * servicio, así que 25 trabajos costaban ~25 USD/mes de puro mínimo. Ahora los
 * dispara el propio servicio web desde `scheduler.ts`, y un único cron externo
 * golpea `/api/cron/tick` cada 10 minutos para que la instancia free no se
 * duerma (Render la apaga tras 15 minutos sin tráfico entrante, y una
 * instancia dormida no puede despertarse sola).
 *
 * Los horarios son los mismos que tenían los cron jobs y se evalúan en UTC,
 * igual que Render.
 */

export type ScheduledJob = {
  /** Nombre estable; es el que se ve en `cron_runs` y en los logs. */
  name: string;
  /** Ruta del endpoint, relativa a la raíz del sitio. */
  path: string;
  /** Expresión cron de 5 campos (min hora día-mes mes día-semana), en UTC. */
  schedule: string;
  /**
   * Corte de la llamada, sólo para los trabajos que tardan más que el default.
   * Que expire no frena el handler del otro lado: sólo suelta el guard de
   * "todavía corriendo", así que quedarse corto reabre la puerta a apilar
   * corridas.
   */
  timeoutMs?: number;
};

/** Suficiente para el más lento de los normales (contacts-sync, ~30 s). */
export const DEFAULT_TIMEOUT_MS = 180_000;

export const SCHEDULED_JOBS: ScheduledJob[] = [
  // --- cada minuto ---
  { name: "flows-resume", path: "/api/cron/flows-resume", schedule: "* * * * *" },
  { name: "automations", path: "/api/automations/cron", schedule: "* * * * *" },
  { name: "flows-retries", path: "/api/flows/retries/cron", schedule: "* * * * *" },
  { name: "broadcasts", path: "/api/broadcasts/cron", schedule: "* * * * *" },
  { name: "voice-calls", path: "/api/cron/voice-calls", schedule: "* * * * *" },
  { name: "voice-campaign-run", path: "/api/cron/voice-campaign-run", schedule: "* * * * *" },

  // --- minutos ---
  { name: "instagram-agent", path: "/api/cron/instagram-agent", schedule: "*/2 * * * *" },
  { name: "outlook-poll", path: "/api/cron/outlook-poll", schedule: "*/2 * * * *" },
  { name: "gmail-poll", path: "/api/cron/gmail-poll", schedule: "*/5 * * * *" },
  { name: "mercadolibre", path: "/api/cron/mercadolibre", schedule: "*/5 * * * *" },
  { name: "comment-sync", path: "/api/cron/comment-sync", schedule: "*/10 * * * *" },
  { name: "contacts-sync", path: "/api/cron/contacts-sync", schedule: "*/10 * * * *" },
  { name: "tiktok-comments", path: "/api/cron/tiktok-comments", schedule: "*/10 * * * *" },
  {
    name: "instagram-external-enrich",
    path: "/api/cron/instagram-external-enrich",
    schedule: "*/10 * * * *",
  },
  { name: "flows-sweep", path: "/api/flows/cron", schedule: "*/15 * * * *" },
  { name: "ai-followups", path: "/api/cron/ai-followups", schedule: "*/30 * * * *" },
  { name: "delivery-watchdog", path: "/api/cron/delivery-watchdog", schedule: "*/30 * * * *" },

  // --- horas ---
  { name: "shopify-cart-recovery", path: "/api/cron/shopify-cart-recovery", schedule: "0 * * * *" },
  { name: "tiendanube-checkouts", path: "/api/cron/tiendanube-checkouts", schedule: "15 * * * *" },
  { name: "shopify-feedback", path: "/api/cron/shopify-feedback", schedule: "30 * * * *" },
  { name: "meta-contact-names", path: "/api/cron/meta-contact-names", schedule: "0 */6 * * *" },
  {
    name: "meta-webhook-subscriptions",
    path: "/api/cron/meta-webhook-subscriptions",
    schedule: "0 */6 * * *",
  },
  { name: "gmail-watch", path: "/api/cron/gmail-watch", schedule: "0 */12 * * *" },
  { name: "outlook-watch", path: "/api/cron/outlook-watch", schedule: "0 */12 * * *" },

  // --- diarios ---
  // Diario y no horario: medido en prod 2026-08-04, cada corrida tarda ~22 min
  // y mueve la mayor parte del ancho de banda del servicio. Con schedule
  // horario se apilaba encima de sí mismo (48 corridas = 17,6 h de trabajo en
  // una ventana de 17,7 h). Es un backfill de respaldo — los DMs nuevos entran
  // por webhook, esto sólo recupera lo que Meta no entregó.
  {
    name: "meta-dm-backfill",
    path: "/api/cron/meta-dm-backfill",
    schedule: "0 5 * * *",
    timeoutMs: 1_800_000,
  },
  { name: "pii-purge", path: "/api/cron/pii-purge", schedule: "0 3 * * *" },
  { name: "meta-token-refresh", path: "/api/cron/meta-token-refresh", schedule: "0 6 * * *" },
  { name: "reengagement", path: "/api/cron/reengagement", schedule: "0 14 * * *" },
];

/**
 * Evalúa un campo cron contra un valor. Soporta comodín, número exacto,
 * rangos, pasos (con y sin rango) y listas separadas por coma.
 *
 * Devuelve `false` ante cualquier expresión que no entienda: un trabajo que no
 * corre se nota en `cron_runs`, uno que corre a destiempo no.
 */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(",").some((part) => {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) return false;

    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
      from = a;
      to = b;
    } else {
      const exact = Number(range);
      if (!Number.isInteger(exact)) return false;
      // `5/10` no es válido en cron estándar; sólo `5` a secas.
      if (stepRaw !== undefined) return false;
      return exact === value;
    }

    if (from < min || to > max || from > to) return false;
    if (value < from || value > to) return false;
    return (value - from) % step === 0;
  });
}

/**
 * ¿Le toca a esta expresión en este minuto? Siempre en UTC, como los cron
 * jobs de Render, para que mover el trabajo adentro de la app no corra los
 * horarios de lugar.
 *
 * Día-del-mes y día-de-semana se combinan con OR cuando ninguno es `*`, que es
 * la regla de cron de siempre. Domingo es 0 (7 también se acepta).
 */
export function isDue(schedule: string, at: Date): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  if (!fieldMatches(minute, at.getUTCMinutes(), 0, 59)) return false;
  if (!fieldMatches(hour, at.getUTCHours(), 0, 23)) return false;
  if (!fieldMatches(month, at.getUTCMonth() + 1, 1, 12)) return false;

  const dom = at.getUTCDate();
  const dow = at.getUTCDay();
  const domRestricted = dayOfMonth !== "*";
  const dowRestricted = dayOfWeek !== "*";
  const domOk = fieldMatches(dayOfMonth, dom, 1, 31);
  const dowOk =
    fieldMatches(dayOfWeek, dow, 0, 7) || (dow === 0 && fieldMatches(dayOfWeek, 7, 0, 7));

  if (domRestricted && dowRestricted) return domOk || dowOk;
  if (domRestricted) return domOk;
  if (dowRestricted) return dowOk;
  return true;
}

/** Trabajos que corresponden al minuto de `at`. */
export function dueJobs(at: Date): ScheduledJob[] {
  return SCHEDULED_JOBS.filter((job) => isDue(job.schedule, at));
}
