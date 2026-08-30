import type { SupabaseClient } from '@supabase/supabase-js'
import type { NeedsHumanReason } from '@/types'

/**
 * QUÉ PASA DESPUÉS DE CADA DESENLACE. Una sola tabla, y no doce decisiones
 * sueltas repartidas por el código.
 *
 * Antes, cada guarda hacía dos llamadas por su cuenta: `logReply(...)` para
 * dejar el motivo y, si a quien lo escribió le parecía, `flagNeedsHuman(...)`
 * para que lo mirara una persona. Nada obligaba a que fueran juntas, y por eso
 * se olvidaban — el 2026-08-30 había tres casos en los que el cliente escribía,
 * no recibía nada, y la conversación quedaba como si estuviera atendida:
 *
 *   - `empty_reply`: el modelo no devolvió texto. Nadie contestó y nadie se
 *     enteró.
 *   - `ai_no_credit` / `ai_upstream` / `ai_error`: se le manda al cliente "en un
 *     momento te responde una persona" y NO se marcaba para ninguna persona.
 *     Prometer y no cumplir es peor que callarse.
 *   - `tool_loop_truncated_fallback`: sale un "no pude completar la consulta"
 *     genérico y el registro decía `sent`, como una respuesta cualquiera.
 *
 * Ahora el desenlace se declara acá y `logReply` lo aplica. Agregar un motivo
 * nuevo sin decidir qué hace es imposible: el tipo no compila y el test de
 * `desenlace.test.ts` no pasa.
 */

/** Qué se hace con la conversación después de este desenlace. */
export interface Politica {
  /** ¿El cliente recibió una respuesta de verdad? */
  contestado: boolean
  /**
   * Con qué motivo queda esperando a una persona. `null` = no escala, y eso
   * también es una decisión: alguien ya la atiende, o el mensaje lo cubre otro
   * turno.
   */
  escala: NeedsHumanReason | null
  /**
   * ¿Además se apaga la IA en ese hilo?
   *
   * Sólo cuando el problema es de la conversación —la persona pidió un humano,
   * se acabó el cupo, hay un lazo—. Un fallo del proveedor NO apaga nada: es
   * pasajero, y dejar mudo al agente en cada hilo que tocó una caída de
   * Anthropic convierte diez minutos de incidente en días de silencio.
   */
  apaga: boolean
  /** Por qué, en una línea, para quien lea esto dentro de seis meses. */
  porque: string
}

const NO_ESCALA = (porque: string): Politica => ({
  contestado: false,
  escala: null,
  apaga: false,
  porque,
})

const ESCALA = (
  escala: NeedsHumanReason,
  porque: string,
  apaga = true,
): Politica => ({ contestado: false, escala, apaga, porque })

export const POLITICA = {
  // ── Contestado ──────────────────────────────────────────────────────────
  sent: {
    contestado: true,
    escala: null,
    apaga: false,
    porque: 'la respuesta salió y llegó al cliente',
  },

  // ── Ya la atiende alguien, o la cubre otro turno ─────────────────────────
  ai_disabled_for_conversation: NO_ESCALA('el comercio apagó la IA en ese chat'),
  conversation_assigned: NO_ESCALA('ya está asignada a una persona'),
  conversation_closed: NO_ESCALA('la conversación estaba cerrada'),
  outside_hours: NO_ESCALA('fuera de horario; se retoma en horario'),
  debounced_by_newer_inbound: NO_ESCALA('llegó otro mensaje: lo cubre ese turno'),
  stale_by_newer_inbound: NO_ESCALA('llegó otro mensaje: lo cubre ese turno'),
  awaiting_approval: NO_ESCALA('la respuesta espera un clic, no una persona'),

  // ── La IA se corre a propósito ──────────────────────────────────────────
  escalation_keyword: ESCALA('escalation_keyword', 'lo pidió el cliente'),
  escalate_after_messages: ESCALA('escalate_after_messages', 'se acabó el cupo de respuestas'),
  reply_burst_guard: ESCALA('reply_burst_guard', 'demasiadas respuestas: parece un lazo'),
  answer_gap: ESCALA('answer_gap', 'no sabía la respuesta y no la inventó'),
  mensaje_no_recibido: ESCALA('mensaje_no_recibido', 'insiste con algo que no nos llega'),

  // ── Nadie contestó, y hay que decirlo ───────────────────────────────────
  // No apagan la IA: el hilo tiene que poder recuperarse solo en el próximo
  // mensaje. Lo que hace falta es que aparezca en "Necesita humano".
  empty_reply: ESCALA('ia_sin_respuesta', 'el modelo no devolvió texto', false),
  tool_loop_truncated_fallback: ESCALA(
    'ia_sin_respuesta',
    'salió el mensaje genérico, no la respuesta',
    false,
  ),
  ai_no_credit: ESCALA('ia_caida', 'sin saldo: se prometió una persona', false),
  ai_rate_limited: ESCALA('ia_caida', 'el proveedor frenó: se prometió una persona', false),
  ai_upstream: ESCALA('ia_caida', 'el proveedor falló: se prometió una persona', false),
  ai_error: ESCALA('ia_caida', 'error del modelo: se prometió una persona', false),
  // El catch de afuera del runner: se rompió algo que no estaba previsto y ni
  // siquiera salió el mensaje de cortesía. Es el peor caso —el cliente escribió
  // y no recibió NADA— y era el único que no dejaba ni un `skip_reason`.
  failed: ESCALA('ia_caida', 'el turno se rompió sin llegar a contestar', false),

  // ── Comentarios ─────────────────────────────────────────────────────────
  // Un comentario que no se contesta casi nunca escala: el silencio es una
  // respuesta válida bajo una publicación. Escala cuando la decisión ERA
  // hacer algo y no se pudo.
  comment_apagado: NO_ESCALA('Comentarios está apagado'),
  comment_sin_saldo: NO_ESCALA('sin saldo'),
  comment_sin_llave: NO_ESCALA('sin clave del modelo'),
  comment_sin_destinatario: NO_ESCALA('no se puede escribir a quien comentó'),
  comment_sin_texto: NO_ESCALA('el comentario no tenía texto'),
  comment_ya_oculto: NO_ESCALA('ya estaba oculto: contestarlo lo revive'),
  // El interruptor del hilo. No escalan: el comercio ya decidió que ese hilo
  // lo lleva él, y volver a marcarlo sería discutirle.
  comment_ia_apagada_en_el_hilo: NO_ESCALA('el comercio apagó la IA en ese hilo'),
  comment_asignado_a_persona: NO_ESCALA('ya lo atiende una persona'),
  comment_hilo_cerrado: NO_ESCALA('el hilo estaba cerrado'),
  comment_espera_aprobacion: NO_ESCALA('la respuesta espera un clic, no una persona'),
  comment_spam: NO_ESCALA('spam: se ocultó y se calla'),
  comment_critica: NO_ESCALA('crítica: se oculta y no se contesta, por decisión del comercio'),
  comment_sin_intencion: NO_ESCALA('no mostraba intención de compra'),
  comment_tope_del_hilo: NO_ESCALA('cupo de respuestas del hilo'),
  comment_tope_por_minuto: NO_ESCALA('ráfaga de comentarios'),
  comment_sin_clasificar: NO_ESCALA('no se pudo clasificar'),
  comment_clasificador_fallo: NO_ESCALA('falló el clasificador'),
  comment_puerta_proactiva: NO_ESCALA('freno de envíos proactivos'),
  comment_sin_conexion: NO_ESCALA('la red no está conectada: es configuración, no un caso'),
  comment_pide_humano: ESCALA('escalation_keyword', 'pidió hablar con una persona'),
  comment_respuesta_vacia: ESCALA('ia_sin_respuesta', 'el modelo no devolvió texto', false),
  comment_afirma_lo_que_no_sabe: ESCALA(
    'ia_sin_respuesta',
    'la respuesta afirmaba lo que no le consta y no salió',
    false,
  ),
  comment_prometia_averiguar: ESCALA('answer_gap', 'prometía averiguar y volver'),
  comment_no_se_pudo_ocultar: ESCALA(
    'comment_sin_moderar',
    'Meta no dejó ocultarlo: sigue publicado',
    false,
  ),
  comment_no_se_pudo_publicar: ESCALA(
    'comment_sin_moderar',
    'Meta no dejó publicar: nadie contestó',
    false,
  ),
  comment_error: ESCALA('ia_caida', 'falló al contestar el comentario', false),
} as const satisfies Record<string, Politica>

/** Todo lo que puede pasar al final de un turno de la IA. */
export type Desenlace = keyof typeof POLITICA

export function politicaDe(desenlace: string): Politica | null {
  return (POLITICA as Record<string, Politica>)[desenlace] ?? null
}

/**
 * Aplica lo que la tabla dice para este desenlace.
 *
 * No pisa un escalado que ya existe (`needs_human_at is null`): quien escaló
 * primero suele tener un resumen mejor —sabe qué pidió la persona y qué
 * herramientas se usaron—, y esto es la red de seguridad, no el camino
 * principal.
 *
 * Best-effort de punta a punta: registrar el desenlace no puede tumbar el turno.
 */
export async function aplicarDesenlace(
  db: SupabaseClient,
  conversationId: string,
  desenlace: string,
  resumen?: string | null,
): Promise<void> {
  const p = politicaDe(desenlace)
  if (!p?.escala || !conversationId) return
  try {
    // El error se MIRA: el cliente de Supabase lo devuelve en el resultado en
    // vez de tirarlo, asi que un `await` suelto lo descarta y el `catch` de
    // abajo nunca se entera. Cinco motivos estuvieron rechazados por la CHECK
    // de la base durante semanas sin una sola linea de log.
    const { error } = await db
      .from('conversations')
      .update({
        needs_human_reason: p.escala,
        needs_human_at: new Date().toISOString(),
        status: 'pending',
        ...(p.apaga ? { ai_enabled: false } : {}),
        ...(resumen ? { needs_human_summary: resumen.slice(0, 500) } : {}),
      })
      .eq('id', conversationId)
      .is('needs_human_at', null)
    if (error) {
      console.error('[ia] el desenlace', desenlace, 'no se escribio:', error.message)
    }
  } catch (err) {
    console.error('[ia] no se pudo aplicar el desenlace', desenlace, err)
  }
}
