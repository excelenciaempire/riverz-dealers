import { supabaseAdmin } from "../admin-client";
import { publicBaseUrl } from "@/lib/base-url";

const TT = "https://business-api.tiktok.com/open_api/v1.3";
/** Nombre propio en `cron_runs`: es un sub-trabajo del cron de comentarios. */
const JOB = "tiktok-webhook";
/** Cada cuánto se vuelve a registrar aunque el proceso siga vivo. */
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Ya se registró en ESTE proceso: un deploy (o un cambio de dominio, que
 *  reinicia el servicio) vuelve a intentarlo sin esperar las 6 h. */
let doneThisProcess = false;
/** Reintento tras un fallo. Sin esto el cron —que corre cada minuto— llamaría
 *  a TikTok y escribiría una fila fallida por minuto hasta que se arregle. */
const RETRY_MS = 10 * 60 * 1000;
let lastAttemptMs = 0;

export type WebhookSubscribeResult =
  | "ok"
  | "skipped"
  | "no-credentials"
  | `error: ${string}`;

/**
 * Deja el webhook de comentarios registrado en TikTok, desde el propio servicio.
 *
 * TikTok no configura webhooks en el portal: la suscripción se hace llamando a
 * `/business/webhook/update/` con el app_id + secret y `event_type: COMMENT`,
 * y queda a nivel de la app (vale para todas las cuentas que la autoricen, sin
 * volver a suscribir una por una).
 *
 * Que lo haga el servicio y no una persona es deliberado: la URL registrada
 * afuera es justo lo que queda apuntando a un servidor muerto cuando cambia el
 * dominio, y nadie se entera hasta que faltan días de comentarios. Al correr
 * en cada arranque, un deploy con `NEXT_PUBLIC_SITE_URL` nuevo se recupera
 * solo. Es idempotente: reenviar la misma URL no duplica nada.
 *
 * Sin esto, las acciones hechas dentro de la app de TikTok (borrar u ocultar
 * un comentario) no llegan nunca — el poll sólo sabe de comentarios nuevos.
 */
export async function ensureTikTokCommentWebhook(): Promise<WebhookSubscribeResult> {
  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !secret) return "no-credentials";

  const db = supabaseAdmin();
  if (doneThisProcess) {
    const { data: last } = await db
      .from("cron_runs")
      .select("started_at, status")
      .eq("name", JOB)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const at = (last as { started_at?: string; status?: string } | null)?.started_at;
    const ok = (last as { status?: string } | null)?.status === "ok";
    if (at && ok && Date.now() - new Date(at).getTime() < EVERY_MS) return "skipped";
  } else if (Date.now() - lastAttemptMs < RETRY_MS) {
    return "skipped";
  }

  const callbackUrl = `${publicBaseUrl()}/api/tiktok/webhook`;
  const startedAt = new Date();
  lastAttemptMs = Date.now();
  let status: "ok" | "error" = "ok";
  let error: string | null = null;
  try {
    const r = await fetch(`${TT}/business/webhook/update/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        secret,
        event_type: "COMMENT",
        callback_url: callbackUrl,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string };
    if (!r.ok || (j.code ?? 0) !== 0) {
      status = "error";
      error = `TikTok ${j.code ?? r.status}: ${j.message ?? ""}`.slice(0, 500);
    }
  } catch (err) {
    status = "error";
    error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }

  // Queda registrado con nombre propio para que el panel lo muestre como lo que
  // es: un trabajo que corre y puede fallar, no un detalle invisible del poll.
  try {
    await db.from("cron_runs").insert({
      name: JOB,
      status,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
      // La URL viaja en el campo de error incluso cuando salió bien: es el dato
      // que hay que mirar cuando "el webhook no llega" tras mudar de dominio.
      error: status === "ok" ? `→ ${callbackUrl}` : `${error} (→ ${callbackUrl})`,
    });
  } catch {
    /* best-effort */
  }

  if (status === "ok") {
    doneThisProcess = true;
    return "ok";
  }
  console.error("[tiktok/webhook-subscribe]", error);
  return `error: ${error ?? "unknown"}`;
}
