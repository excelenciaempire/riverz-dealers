import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt } from "../encryption";
import { withAppsecretProof } from "../meta-graph";
import { savePollState } from "../poll-state";

const GRAPH = "https://graph.facebook.com/v25.0";

/** Meta sólo acepta el pedido dentro de las 24 horas posteriores al onboarding. */
const SYNC_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Coexistencia: pide a Meta los contactos y el historial (hasta 180 días) de
 * la app de WhatsApp Business del comercio. No vienen en la respuesta: llegan
 * por webhook (`smb_app_state_sync` y `history`) y el adaptador los guarda como
 * históricos, sin IA ni automatizaciones.
 *
 * Es la única forma de traer chats anteriores de WhatsApp, y Meta la acepta una
 * sola vez y sólo en las 24 horas posteriores al onboarding: pasado eso hay que
 * volver a conectar el número. Sin este pedido el historial no llega nunca.
 *
 * Nunca lanza: el resultado queda anotado en la conexión.
 */
export async function requestCoexistenceHistorySync(
  db: SupabaseClient,
  args: { connectionId: string; phoneNumberId: string; token: string },
): Promise<boolean> {
  const failures: Record<string, string> = {};
  // Primero los contactos, así el historial ya encuentra los nombres.
  for (const syncType of ["smb_app_state_sync", "history"] as const) {
    try {
      const res = await fetch(
        withAppsecretProof(`${GRAPH}/${args.phoneNumberId}/smb_app_data`, args.token),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${args.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        failures[syncType] = `${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`;
      }
    } catch (err) {
      failures[syncType] = err instanceof Error ? err.message : String(err);
    }
  }
  if (Object.keys(failures).length) {
    console.warn("[whatsapp/history-sync] Meta rechazó el pedido", {
      connectionId: args.connectionId,
      failures,
    });
  }

  const requested = !failures.history;
  await savePollState(
    db,
    args.connectionId,
    requested
      ? { history_sync_requested_at: new Date().toISOString(), history_sync_error: null }
      : { history_sync_error: failures.history.slice(0, 500) },
    null,
    { complete: false },
  ).catch((err) =>
    console.warn("[whatsapp/history-sync] no se pudo anotar el resultado", err),
  );
  return requested;
}

/**
 * Segundo intento desde el backfill, para cuando el pedido del onboarding
 * falló: sólo en coexistencia, dentro de la ventana de Meta y si el pedido de
 * esta conexión todavía no salió.
 */
export async function retryCoexistenceHistorySync(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<void> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  if (cfg.coexistence !== true) return;
  const connectedAt = Date.parse(String(cfg.connected_at ?? ""));
  if (!Number.isFinite(connectedAt) || Date.now() - connectedAt > SYNC_WINDOW_MS) return;
  const requestedAt = Date.parse(String(cfg.history_sync_requested_at ?? ""));
  if (Number.isFinite(requestedAt) && requestedAt >= connectedAt) return;

  const encrypted = String(
    (connection.secrets as Record<string, unknown> | null)?.access_token ?? "",
  );
  const phoneNumberId = String(cfg.phone_number_id ?? connection.external_account_id ?? "");
  if (!encrypted || !phoneNumberId) return;
  let token: string;
  try {
    token = decrypt(encrypted);
  } catch {
    return;
  }
  await requestCoexistenceHistorySync(db, {
    connectionId: connection.id,
    phoneNumberId,
    token,
  });
}
