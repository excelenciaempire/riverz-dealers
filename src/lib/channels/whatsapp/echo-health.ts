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
 * El conteo es diagnóstico, no prueba de un fallo: el comercio puede atender
 * sólo desde Riverz o no haber enviado nada desde el teléfono. No se genera
 * una alarma ni se exige reconectar a partir de ausencia de ecos.
 */

/** Código de la alarma en `config.health_sync_error`. Sin dependencias: lo usa la UI. */
export const COEXISTENCE_ECHOES_MISSING = "coexistence_echoes_missing";

/** Límite de muestra del diagnóstico; no es un umbral de fallo. */
const MIN_CUSTOMER_MESSAGES = 5;

const WINDOW_MS = 24 * 60 * 60_000;

export interface EchoCounts {
  /** Mensajes de clientes en la ventana (se cuenta hasta MIN + 1). */
  customers: number;
  /** Ecos del teléfono del comercio en la ventana (0 o 1). */
  echoes: number;
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
 * Diagnóstico de actividad y limpieza de las alarmas antiguas basadas en
 * silencio. Null si la conexión no es de coexistencia. Una lectura fallida
 * devuelve counts=null, nunca una afirmación de que se perdieron mensajes.
 */
export async function checkCoexistenceEchoes(
  db: SupabaseClient,
  connection: ChannelConnection,
  nowMs = Date.now(),
): Promise<{ alarm: boolean; counts: EchoCounts | null; patch: Record<string, unknown> } | null> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  if (cfg.coexistence !== true) return null;
  const counts = await countCoexistenceEchoes(db, connection, nowMs);
  return {
    alarm: false,
    counts,
    patch: { echoes_missing_since: null },
  };
}
