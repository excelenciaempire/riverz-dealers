import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

/**
 * Alarma de ecos de coexistencia.
 *
 * En coexistencia el comercio sigue contestando desde la app de WhatsApp
 * Business y Meta manda cada respuesta como eco (`smb_message_echoes`). Si los
 * ecos dejan de llegar no falla nada a la vista: la bandeja muestra al cliente
 * escribiendo y a nadie contestando, la IA puede responder encima de una
 * persona que ya respondió, y las métricas de respuesta mienten. Pasó: desde
 * que se conectó el único número en coexistencia no llegó un solo eco, aunque
 * los clientes recibían respuestas desde el teléfono.
 *
 * Por eso se mide lo que sí se puede ver: más de cinco mensajes de clientes en
 * 24 horas (desde la conexión) sin un solo eco. La alarma queda en
 * `config.health_sync_error` y se apaga cuando aparece un eco.
 */

/** Código de la alarma en `config.health_sync_error`. Sin dependencias: lo usa la UI. */
export const COEXISTENCE_ECHOES_MISSING = "coexistence_echoes_missing";

/**
 * Una alarma de una conexión anterior no aplica después de reconectar. El
 * `connected_at` nuevo abre otra ventana y necesita evidencia nueva.
 */
export function hasCurrentCoexistenceEchoAlarm(
  config: Record<string, unknown>,
): boolean {
  if (config.health_sync_error !== COEXISTENCE_ECHOES_MISSING) return false;
  const alarmAt = Date.parse(String(config.echoes_missing_since ?? ""));
  const connectedAt = Date.parse(String(config.connected_at ?? ""));
  return (
    !Number.isFinite(alarmAt) ||
    !Number.isFinite(connectedAt) ||
    alarmAt >= connectedAt
  );
}

/** Más de estos mensajes de clientes sin un solo eco ya no es casualidad. */
const MIN_CUSTOMER_MESSAGES = 5;

const WINDOW_MS = 24 * 60 * 60_000;

export interface EchoCounts {
  /** Mensajes de clientes en la ventana (se cuenta hasta MIN + 1). */
  customers: number;
  /** Ecos del teléfono del comercio en la ventana (0 o 1). */
  echoes: number;
}

/**
 * ¿Sigue prendida la alarma? Se prende con tráfico y ningún eco, y se apaga
 * sólo cuando aparece uno: un día tranquilo no prueba que el problema se fue.
 */
export function nextEchoAlarm(previous: boolean, counts: EchoCounts): boolean {
  if (counts.echoes > 0) return false;
  if (counts.customers > MIN_CUSTOMER_MESSAGES) return true;
  return previous;
}

/**
 * Mensajes de clientes y ecos de las últimas 24 horas de esta conexión, sin
 * contar nada anterior a la conexión (el historial importado también trae
 * respuestas del comercio, y no son ecos). Un eco es lo que el comercio mandó
 * desde el teléfono: agente sin persona de Riverz (`sender_id`), sin origen
 * automático (`origin`) y con id de WhatsApp. Null si la lectura falló.
 */
export async function countCoexistenceEchoes(
  db: SupabaseClient,
  connection: ChannelConnection,
  nowMs = Date.now(),
): Promise<EchoCounts | null> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const connectedAt = Date.parse(String(cfg.connected_at ?? connection.created_at ?? ""));
  const since = new Date(
    Math.max(nowMs - WINDOW_MS, Number.isFinite(connectedAt) ? connectedAt : 0),
  ).toISOString();
  const scoped = () =>
    db
      .from("messages")
      .select("id, conversations!inner(connection_id, workspace_id)")
      .eq("conversations.workspace_id", connection.workspace_id)
      .eq("conversations.connection_id", connection.id)
      .eq("channel", "whatsapp")
      .gt("created_at", since);
  const [customers, echoes] = await Promise.all([
    scoped().eq("sender_type", "customer").limit(MIN_CUSTOMER_MESSAGES + 1),
    scoped()
      .eq("sender_type", "agent")
      .is("sender_id", null)
      .is("origin", null)
      .like("message_id", "wamid%")
      .limit(1),
  ]);
  if (customers.error || echoes.error) return null;
  return { customers: customers.data?.length ?? 0, echoes: echoes.data?.length ?? 0 };
}

/**
 * La alarma de una conexión y el parche de config que la conserva. Null si la
 * conexión no es de coexistencia. Si la lectura falla, la alarma queda como
 * estaba: un error de base no la apaga ni la prende.
 */
export async function checkCoexistenceEchoes(
  db: SupabaseClient,
  connection: ChannelConnection,
  nowMs = Date.now(),
): Promise<{ alarm: boolean; counts: EchoCounts | null; patch: Record<string, unknown> } | null> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  if (cfg.coexistence !== true) return null;
  const storedSince = typeof cfg.echoes_missing_since === "string" ? cfg.echoes_missing_since : null;
  const connectedAt = Date.parse(String(cfg.connected_at ?? ""));
  const since = storedSince && (!Number.isFinite(connectedAt) || Date.parse(storedSince) >= connectedAt)
    ? storedSince
    : null;
  const counts = await countCoexistenceEchoes(db, connection, nowMs);
  const alarm = counts ? nextEchoAlarm(Boolean(since), counts) : Boolean(since);
  return {
    alarm,
    counts,
    // Desde cuándo falta: sobrevive a otros errores que ocupen health_sync_error.
    patch: { echoes_missing_since: alarm ? (since ?? new Date(nowMs).toISOString()) : null },
  };
}
