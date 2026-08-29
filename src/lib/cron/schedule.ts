/**
 * Inventario de trabajos periódicos, en el repo y no en el dashboard.
 *
 * Antes cada entrada de esta lista era un Render Cron Job. Render cobra un
 * mínimo de 1 USD/mes POR cron job y no tiene plan gratuito para ese tipo de
 * servicio, así que 25 trabajos costaban ~25 USD/mes de puro mínimo. Ahora los
 * dispara el propio servicio web desde `scheduler.ts`, sin ningún servicio
 * externo: el web corre en un plan pago, que no se apaga por inactividad, así
 * que el reloj vive mientras el proceso esté arriba.
 *
 * Nada de esto sobrevive en el plan free: ahí Render apaga la instancia tras
 * 15 minutos sin tráfico entrante y hace falta un cron externo golpeando
 * `/api/cron/tick` para mantenerla despierta.
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
  /**
   * Clave i18n de "qué hace", en el namespace `admin`. Es clave y no texto
   * porque el panel de plataforma la pinta y Riverz se ve en dos idiomas.
   */
  whatKey: string;
  /**
   * Sub-trabajo: no lo dispara el reloj, lo dispara otro trabajo con su propio
   * ritmo interno (`pingCron`) porque es más caro que su padre. Escribe en
   * `cron_runs` con nombre propio, así que necesita fila y umbral propios en el
   * panel — antes no estaban en ningún catálogo y eran invisibles.
   */
  parent?: string;
};

/** Suficiente para el más lento de los normales (contacts-sync, ~30 s). */
export const DEFAULT_TIMEOUT_MS = 180_000;

export const SCHEDULED_JOBS: ScheduledJob[] = [
  // --- cada minuto ---
  { name: "flows-resume", whatKey: "admin.cronFlowsResume", path: "/api/cron/flows-resume", schedule: "* * * * *" },
  { name: "automations", whatKey: "admin.cronAutomations", path: "/api/automations/cron", schedule: "* * * * *" },
  { name: "flows-retries", whatKey: "admin.cronFlowsRetries", path: "/api/flows/retries/cron", schedule: "* * * * *" },
  { name: "broadcasts", whatKey: "admin.cronBroadcasts", path: "/api/broadcasts/cron", schedule: "* * * * *" },
  { name: "voice-calls", whatKey: "admin.cronVoiceCalls", path: "/api/cron/voice-calls", schedule: "* * * * *" },
  { name: "voice-campaign-run", whatKey: "admin.cronVoiceCampaignRun", path: "/api/cron/voice-campaign-run", schedule: "* * * * *" },

  // --- minutos ---
  { name: "instagram-agent", whatKey: "admin.cronInstagramAgent", path: "/api/cron/instagram-agent", schedule: "*/2 * * * *" },
  { name: "outlook-poll", whatKey: "admin.cronOutlookPoll", path: "/api/cron/outlook-poll", schedule: "*/2 * * * *" },
  { name: "gmail-poll", whatKey: "admin.cronGmailPoll", path: "/api/cron/gmail-poll", schedule: "*/5 * * * *" },
  { name: "mercadolibre", whatKey: "admin.cronMercadolibre", path: "/api/cron/mercadolibre", schedule: "*/5 * * * *" },
  { name: "comment-sync", whatKey: "admin.cronCommentSync", path: "/api/cron/comment-sync", schedule: "*/10 * * * *" },
  { name: "contacts-sync", whatKey: "admin.cronContactsSync", path: "/api/cron/contacts-sync", schedule: "*/10 * * * *" },
  // La recarga automática de la billetera. Cada 5 minutos: entre que el saldo
  // cae y que la IA se queda muda hay margen —el descubierto—, y un cobro con
  // tarjeta no conviene apurarlo. Lo bastante seguido para que nadie se entere
  // de que estuvo en cero, lo bastante espaciado para que un fallo no se
  // multiplique por sesenta.
  { name: "wallet-autorecarga", whatKey: "admin.cronWalletAutorecarga", path: "/api/cron/wallet-autorecarga", schedule: "*/5 * * * *" },
  // Cada 5 minutos, que es el ritmo al que TikTok entrega de verdad: su propio
  // webhook comment.update se dispara "dentro de 5 min", así que preguntar más
  // seguido no adelanta nada. Estaba cada minuto y se medía: 1.434 corridas por
  // día y ~15.700 llamadas a la API de TikTok para traer 2 o 3 comentarios —
  // el 37% del cómputo de TODA la plataforma. Cuesta 11 llamadas por corrida y
  // por cuenta conectada (1 de videos + 10 de comentarios).
  // Lo que se siente instantáneo no es esto: el hilo abierto se refresca solo
  // (/api/conversations/:id/tiktok-refresh) y el barrido profundo de 6 h cubre
  // el catálogo entero.
  { name: "tiktok-comments", whatKey: "admin.cronTiktokComments", path: "/api/cron/tiktok-comments", schedule: "*/5 * * * *" },
  // Lo que DICE cada video, que es el contexto sin el cual un comentario no se
  // puede contestar. Cron propio y no de prestado dentro del poll: en el panel
  // se ve si se atrasa, y un video recién publicado —que es cuando llegan casi
  // todos sus comentarios— queda transcripto en minutos.
  {
    name: "tiktok-transcripciones", whatKey: "admin.cronTiktokTranscripciones",
    path: "/api/cron/tiktok-transcripciones",
    schedule: "*/15 * * * *",
    timeoutMs: 300_000,
  },
  {
    name: "instagram-external-enrich", whatKey: "admin.cronInstagramEnrich",
    path: "/api/cron/instagram-external-enrich",
    schedule: "*/10 * * * *",
  },
  // El nombre TIENE que ser el que escribe el endpoint (`withCronRun` en
  // /api/flows/cron dice "flows-cron"). Estaba declarado como "flows-sweep" y
  // ese nombre no existía en `cron_runs`: el trabajo corría cada 15 minutos sin
  // fallar nunca, pero el panel y el vigilante lo daban por muerto para
  // siempre, y ese falso positivo viajaba en cada aviso.
  { name: "flows-cron", whatKey: "admin.cronFlowsSweep", path: "/api/flows/cron", schedule: "*/15 * * * *" },
  // Espeja los contactos hacia Klaviyo. Por marca de agua: la primera corrida
  // sube la base y las siguientes sólo lo que cambió.
  { name: "klaviyo-sync", whatKey: "admin.cronKlaviyoSync", path: "/api/cron/klaviyo-sync", schedule: "*/15 * * * *" },
  { name: "ai-followups", whatKey: "admin.cronAiFollowups", path: "/api/cron/ai-followups", schedule: "*/30 * * * *" },
  // Red de seguridad del webhook de Mercado Pago: levanta lo que no haya
  // llegado por aviso. Sólo ingesta; el envío lo decide mercadopago-recovery.
  { name: "mercadopago-sync", whatKey: "admin.cronMercadopagoSync", path: "/api/cron/mercadopago-sync", schedule: "*/30 * * * *" },
  { name: "delivery-watchdog", whatKey: "admin.cronDeliveryWatchdog", path: "/api/cron/delivery-watchdog", schedule: "*/30 * * * *" },
  // Las ventas del chat que no le llegaron a Meta. Casi todo lo que falla acá
  // se arregla solo o en un rato (un 500, la red, un token que el comercio
  // renueva), y sin reintento cada uno de esos ratos es una venta que el
  // algoritmo nunca supo que ocurrió. Meta descarta lo que tenga más de 7 días,
  // así que el barrido tiene que ser frecuente, y sale barato: sin pendientes
  // es una consulta contra un índice parcial vacío.
  { name: "conversion-retry", whatKey: "admin.cronConversionRetry", path: "/api/cron/conversion-retry", schedule: "*/15 * * * *" },
  // Vivía en un workflow de GitHub Actions con la URL de producción guardada en
  // un secret: al mudar de dominio quedó apuntando al host viejo y el mapa
  // post_id → ad_id se congeló, así que los comentarios sobre anuncios dejaron
  // de marcarse como tales. Acá dentro la URL no puede desviarse.
  { name: "ads-sync", whatKey: "admin.cronAdsSync", path: "/api/meta/ads-sync", schedule: "*/30 * * * *" },
  // Le avisa al EQUIPO lo que se rompió, apenas se rompe. `issues-alert` avisa
  // al comercio una vez por día; este avisa acá y ahora, y sólo lo nuevo.
  { name: "platform-watch", whatKey: "admin.cronPlatformWatch", path: "/api/cron/platform-watch", schedule: "*/15 * * * *" },

  // --- horas ---
  // Cada 5 minutos, igual que la recuperación de pagos. El checkout entra por
  // webhook en segundos y la espera de 2 h la aplica el propio cron, así que
  // correr una vez por hora le sumaba hasta 59 minutos a esa espera: un
  // carrito abandonado a las 10:05 recién salía a las 13:00.
  { name: "shopify-cart-recovery", whatKey: "admin.cronShopifyCartRecovery", path: "/api/cron/shopify-cart-recovery", schedule: "*/5 * * * *" },
  { name: "tiendanube-checkouts", whatKey: "admin.cronTiendanubeCheckouts", path: "/api/cron/tiendanube-checkouts", schedule: "15 * * * *" },
  // Cada 5 minutos: con el webhook de Mercado Pago el rechazo entra en
  // segundos, y una cola que arranca una vez por hora se comía esa ventaja.
  // La corrida sale barata — sin filas pendientes devuelve enseguida.
  { name: "mercadopago-recovery", whatKey: "admin.cronMercadopagoRecovery", path: "/api/cron/mercadopago-recovery", schedule: "*/5 * * * *" },
  { name: "shopify-feedback", whatKey: "admin.cronShopifyFeedback", path: "/api/cron/shopify-feedback", schedule: "30 * * * *" },
  { name: "meta-contact-names", whatKey: "admin.cronMetaContactNames", path: "/api/cron/meta-contact-names", schedule: "0 */6 * * *" },
  {
    name: "meta-webhook-subscriptions", whatKey: "admin.cronMetaWebhookSubs",
    path: "/api/cron/meta-webhook-subscriptions",
    schedule: "0 */6 * * *",
  },
  // El mismo desvío de dominio, del lado de las tiendas: Shopify, Tiendanube y
  // WooCommerce guardan la URL al conectar y no la revisan nunca más.
  {
    name: "commerce-webhooks", whatKey: "admin.cronCommerceWebhooks",
    path: "/api/cron/commerce-webhooks",
    schedule: "30 */6 * * *",
  },
  // De madrugada: leer la página de un producto tarda segundos y el research
  // cuesta tokens, así que se hace cuando nadie está mirando y por tandas.
  { name: "catalog-enrich", whatKey: "admin.cronCatalogEnrich", path: "/api/cron/catalog-enrich", schedule: "0 4 * * *" },
  { name: "gmail-watch", whatKey: "admin.cronGmailWatch", path: "/api/cron/gmail-watch", schedule: "0 */12 * * *" },
  { name: "outlook-watch", whatKey: "admin.cronOutlookWatch", path: "/api/cron/outlook-watch", schedule: "0 */12 * * *" },

  // Cada 2 h, en tramos. Antes era diario y de una sola pasada porque cada
  // corrida barría TODOS los contactos de TODAS las cuentas (~22 min medidos
  // el 2026-08-04) y con schedule horario se apilaba encima de sí mismo. Peor:
  // pasado el timeout, el reloj corta el `fetch`, `withCronRun` no llega a
  // escribir la fila y el trabajo se apaga sin dejar rastro — así estuvo mudo
  // del 2026-08-26 al 2026-08-29 sin un solo error registrado.
  //
  // Ahora el handler procesa un lote fijo por conexión y guarda un cursor, así
  // que una corrida vale lo mismo con una cuenta que con doscientas. Doce
  // tramos por día cubren más que una pasada diaria que no termina. Es un
  // backfill de respaldo: los DMs nuevos entran por webhook, esto recupera lo
  // que Meta no entregó.
  {
    name: "meta-dm-backfill", whatKey: "admin.cronMetaDmBackfill",
    path: "/api/cron/meta-dm-backfill",
    schedule: "0 */2 * * *",
    timeoutMs: 900_000,
  },

  // --- diarios ---
  { name: "pii-purge", whatKey: "admin.cronPiiPurge", path: "/api/cron/pii-purge", schedule: "0 3 * * *" },
  // Acumula lo que consumio cada cuenta: conversaciones atendidas por IA,
  // respuestas, tokens y lo que nos costo. Corre sobre AYER —que ya cerro, asi
  // que el numero es definitivo— y sobre HOY, para que la pantalla del comercio
  // no muestre el consumo con un dia de atraso. Volver a correrlo es seguro: la
  // clave es (cuenta, dia) y se pisa.
  { name: "billing-usage", whatKey: "admin.cronBillingUsage", path: "/api/cron/billing-usage", schedule: "15 * * * *" },
  // Avisa por correo lo que se rompió en silencio. Una vez por día: la
  // frecuencia es la deduplicación, y si sigue roto mañana vuelve a avisar.
  { name: "issues-alert", whatKey: "admin.cronIssuesAlert", path: "/api/cron/issues-alert", schedule: "0 13 * * *" },
  { name: "meta-token-refresh", whatKey: "admin.cronMetaTokenRefresh", path: "/api/cron/meta-token-refresh", schedule: "0 6 * * *" },
  // Cada quince minutos, y no una vez al dia como el de Meta: el token de
  // Shopify dura UNA HORA. Con una corrida diaria la tienda estaria vencida el
  // 96% del tiempo.
  { name: "shopify-token-refresh", whatKey: "admin.cronShopifyTokenRefresh", path: "/api/cron/shopify-token-refresh", schedule: "*/15 * * * *" },
  { name: "reengagement", whatKey: "admin.cronReengagement", path: "/api/cron/reengagement", schedule: "0 14 * * *" },

  // --- sub-trabajos ---
  // El reloj NO los dispara (los filtra `dueJobs` por tener `parent`): los
  // dispara su padre con un ritmo interno propio, porque son más caros que él.
  // Están acá porque escriben en `cron_runs` con nombre propio y sin fila en el
  // catálogo eran invisibles para el panel: corrían, fallaban y nadie lo veía.
  // El `schedule` es su cadencia real, y sirve para el umbral de atraso.
  {
    name: "comment-sync-reconcile", whatKey: "admin.cronCommentReconcile",
    path: "/api/cron/comment-sync",
    schedule: "*/10 * * * *",
    parent: "comment-sync",
  },
  {
    name: "tiktok-webhook", whatKey: "admin.cronTiktokWebhook",
    path: "/api/cron/tiktok-comments",
    schedule: "0 */6 * * *",
    parent: "tiktok-comments",
  },
  // El poll de cada minuto sólo mira los 10 videos más nuevos. Un comentario
  // sobre un video viejo entraba nunca: este barrido recorre TODO el catálogo
  // paginado. Es una llamada por video, así que va cada 6 h y con timeout largo.
  {
    name: "tiktok-comments-deep", whatKey: "admin.cronTiktokDeep",
    path: "/api/cron/tiktok-comments?deep=1",
    schedule: "20 */6 * * *",
    timeoutMs: 600_000,
  },
  {
    name: "mercadolibre-orders", whatKey: "admin.cronMlOrders",
    path: "/api/cron/mercadolibre",
    schedule: "*/15 * * * *",
    parent: "mercadolibre",
  },
  {
    name: "mercadolibre-catalog", whatKey: "admin.cronMlCatalog",
    path: "/api/cron/mercadolibre",
    schedule: "0 * * * *",
    parent: "mercadolibre",
  },
  {
    name: "ml-reviews", whatKey: "admin.cronMlReviews",
    path: "/api/cron/mercadolibre",
    schedule: "0 * * * *",
    parent: "mercadolibre",
  },
  // Escribía en `cron_runs` sin estar declarado acá: corría cada ~9 min y el
  // panel no lo listaba, que es justo el problema que documenta el comentario
  // de arriba de este archivo. El ritmo real lo pone el propio cron de ML
  // (`api/cron/mercadolibre/route.ts`), esto sólo lo hace visible.
  {
    name: "mercadolibre-claims", whatKey: "admin.cronMlClaims",
    path: "/api/cron/mercadolibre",
    schedule: "*/10 * * * *",
    parent: "mercadolibre",
  },
  // El worker de voz no es un cron: es un proceso de fondo en otro servicio,
  // sin puerto que sondear. Late por su cuenta contra
  // /api/internal/voice/heartbeat, así que entra por la misma puerta que los
  // sub-trabajos: `parent` impide que el reloj lo llame (no hay a dónde), y la
  // fila le da umbral de atraso y presencia en el panel. Sin esto, "el worker
  // está caído" no se veía en ninguna pantalla.
  {
    name: "voice-worker", whatKey: "admin.cronVoiceWorker",
    path: "",
    schedule: "* * * * *",
    parent: "voice-calls",
  },
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

/**
 * Trabajos que corresponden al minuto de `at`.
 *
 * Los sub-trabajos quedan fuera: su `schedule` describe cada cuánto DEBERÍAN
 * correr —para poder marcarlos atrasados en el panel— pero quien los dispara es
 * su padre. Lanzarlos desde acá los correría dos veces.
 */
export function dueJobs(at: Date): ScheduledJob[] {
  return SCHEDULED_JOBS.filter((job) => !job.parent && isDue(job.schedule, at));
}

/**
 * Milisegundos que deberían pasar, como mucho, entre dos corridas de este
 * schedule. Vive acá y no en el panel porque el schedule vive acá: tenerlo del
 * otro lado fue exactamente lo que dejó que los dos catálogos se separaran.
 */
export function expectedIntervalMs(schedule: string): number | null {
  const [min, hour] = schedule.split(" ");
  if (min === "*") return 60_000;
  const everyMin = min?.match(/^\*\/(\d+)$/);
  if (everyMin) return Number(everyMin[1]) * 60_000;
  const everyHour = hour?.match(/^\*\/(\d+)$/);
  if (everyHour) return Number(everyHour[1]) * 3_600_000;
  if (hour === "*") return 3_600_000;
  return 24 * 3_600_000;
}

/**
 * ¿Este trabajo lleva demasiado sin reportar? Se dan tres intervalos de margen
 * antes de gritar, para no marcar en rojo por un retraso normal.
 *
 * Sin fecha de última corrida el trabajo está atrasado, no sano: antes esto
 * devolvía `false` para todo lo que no tuviera schedule declarado, y como el
 * catálogo del panel traía `schedule: null` en tres trabajos que sí corrían,
 * esos tres nunca se podían poner en rojo.
 */
export function isStale(schedule: string, lastRunIso: string | null, now = Date.now()): boolean {
  const interval = expectedIntervalMs(schedule);
  if (!interval) return false;
  if (!lastRunIso) return true;
  return now - new Date(lastRunIso).getTime() > interval * 3;
}
