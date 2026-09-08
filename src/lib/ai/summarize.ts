/**
 * Resumidores rodantes para context-engineering del agente IA.
 *
 * Hay dos resumidores con propósitos distintos:
 *
 *   1. `summarizeConversationIfNeeded` — comprime la PARTE VIEJA de
 *      esta conversación específica en ~200 palabras y la guarda en
 *      `conversations.ai_summary`. Disparado cada 30 mensajes.
 *      Migration 048.
 *
 *   2. `summarizeContactIfNeeded` — actualiza `contacts.ai_summary`
 *      con lo que aprendimos del cliente a lo largo de TODAS sus
 *      conversaciones (preferencias, alergias, requests comunes).
 *      Disparado cada 25 mensajes o al cerrar la conversación.
 *      Migration 049.
 *
 * Los dos corren en background (fire-and-forget) y fallan en silencio
 * — nunca rompen el flujo de respuesta del runner.
 *
 * Modelo usado: Claude Haiku 4.5 (rápido y barato), reutiliza la API key
 * del agente si la tiene, sino la global ANTHROPIC_API_KEY.
 */

import { puedeUsarIa } from '@/lib/wallet/puerta';
import type { Contact, Conversation } from '@/types';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropic } from './anthropic-client';
import { resolveAnthropicKey, type KeySource } from './platform-key';
import type { AiAgent } from './types';

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

/** Cantidad de mensajes "recientes" que NUNCA se resumen. El resumen
 *  cubre solamente lo MÁS VIEJO que esto. */
const RECENT_TAIL_COUNT = 20;

/** Cantidad de mensajes nuevos (más allá de la cola reciente) que
 *  disparan un re-summarize. */
const SUMMARIZE_EVERY_N = 30;

async function getApiKey(
  db: SupabaseClient,
  agent: AiAgent
): Promise<{ key: string; source: KeySource } | null> {
  const resolved = await resolveAnthropicKey(db, {
    workspaceId: agent.workspace_id,
    agentKeyEncrypted: agent.api_key_encrypted,
  });
  return resolved ?? null;
}

/**
 * Si la conversación tiene > (RECENT_TAIL_COUNT + SUMMARIZE_EVERY_N)
 * mensajes Y aún no tenemos resumen al día, comprime todo lo viejo en
 * ~200 palabras y guarda en `conversations.ai_summary`.
 *
 * Fail-soft: errores de SDK, de DB o de modelo se loguean y se
 * descartan. Nunca tira.
 */
export async function summarizeConversationIfNeeded(
  db: SupabaseClient,
  conversation: Conversation,
  agent: AiAgent
): Promise<void> {
  try {
    // Sin saldo no se resume. Es la llamada más silenciosa de todas: corre
    // pegada a cada respuesta, no deja rastro en `ai_replies` y por eso su
    // gasto no aparecía en ningún número del panel. Un comercio sin saldo
    // seguía pagándonos resúmenes que nadie contaba.
    if (!(await puedeUsarIa(db, conversation.workspace_id))) return;
    // ── Cuántos mensajes tiene la conversación en total ──
    const { count, error: countErr } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id);
    if (countErr) return;
    const total = count ?? 0;
    if (total < RECENT_TAIL_COUNT + SUMMARIZE_EVERY_N) return;

    // ── ¿Ya estamos al día? ──
    // Si ya hay resumen Y el "up_to_message_id" está dentro de los
    // últimos RECENT_TAIL_COUNT (sea cerca del tail), no hay nada nuevo
    // viejo para meter. Para simplificar usamos heurística de tiempo:
    // si ai_summary_updated_at es < SUMMARIZE_EVERY_N mensajes atrás,
    // skip.
    if (conversation.ai_summary && conversation.ai_summary_up_to_message_id) {
      const { count: newer } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversation.id)
        .gt('created_at', conversation.ai_summary_updated_at ?? '1970-01-01');
      if ((newer ?? 0) < SUMMARIZE_EVERY_N) return;
    }

    const clave = await getApiKey(db, agent);
    if (!clave) return;
    const apiKey = clave.key;

    // ── Cargamos el bloque viejo (todo menos los últimos
    //    RECENT_TAIL_COUNT) ──
    const oldCount = total - RECENT_TAIL_COUNT;
    const { data: oldRows } = await db
      .from('messages')
      .select('id, sender_type, content_text, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(oldCount);
    const rows = (
      (oldRows ?? []) as {
        id: string;
        sender_type: string;
        content_text: string | null;
        created_at: string;
      }[]
    ).filter((r) => r.content_text && r.content_text.trim());
    if (rows.length < 5) return;

    const lastCoveredId = rows[rows.length - 1].id;
    const transcript = rows
      .map((r) => {
        const who =
          r.sender_type === 'customer'
            ? 'Cliente'
            : r.sender_type === 'bot'
              ? 'IA'
              : 'Agente';
        return `${who}: ${r.content_text!.trim()}`;
      })
      .join('\n');

    const client = getAnthropic(apiKey, {
      db,
      workspaceId: conversation.workspace_id,
      concepto: 'ia_resumen',
      origenDeLaClave: clave.source,
    });
    const prompt = `Eres el módulo de memoria de un asistente de servicio al cliente. Recibís un transcripto y devolvés un resumen muy comprimido (máximo 200 palabras) que conserve TODO lo que un siguiente turno del asistente necesitaría: pedido del cliente, productos mencionados, decisiones tomadas, datos compartidos (números de pedido, direcciones, montos), tono y estado emocional. No uses listas con guiones; escribilo como un párrafo denso en español. No incluyas saludos ni meta-comentarios, sólo el resumen.\n\nTranscripto:\n${transcript}`;

    const res = await client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      system:
        'Sos un compresor de contexto. Devolvés un único párrafo en español de máximo 200 palabras, sin viñetas.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) return;

    await db
      .from('conversations')
      .update({
        ai_summary: text,
        ai_summary_up_to_message_id: lastCoveredId,
        ai_summary_updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
  } catch (err) {
    console.error('[ai/summarize] conversation summarize failed:', err);
  }
}

/**
 * Cada N mensajes (o on-close), actualiza `contacts.ai_summary` con un
 * resumen de QUIÉN es el cliente — preferencias, alergias, productos
 * que le interesan, tono, requests recurrentes. Se incluye también el
 * resumen acumulado previo para no perder contexto histórico.
 *
 * Fail-soft.
 */
export async function summarizeContactIfNeeded(
  db: SupabaseClient,
  contact: Contact,
  conversation: Conversation,
  agent: AiAgent,
  opts?: { force?: boolean }
): Promise<void> {
  try {
    if (!(await puedeUsarIa(db, conversation.workspace_id))) return;
    // Disparamos cada 25 mensajes en la conversación actual (o force).
    if (!opts?.force) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversation.id);
      if (!count || count < 25 || count % 25 !== 0) return;
    }

    const clave = await getApiKey(db, agent);
    if (!clave) return;
    const apiKey = clave.key;

    // Tomamos los últimos 60 mensajes de TODAS las conversaciones del
    // contact (no sólo la actual) — así el resumen captura conducta
    // cross-thread.
    const { data: convs } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .order('updated_at', { ascending: false })
      .limit(10);
    const convIds = ((convs ?? []) as { id: string }[]).map((c) => c.id);
    if (convIds.length === 0) return;

    const { data: msgs } = await db
      .from('messages')
      .select('sender_type, content_text, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(60);
    const rows = (
      (msgs ?? []) as {
        sender_type: string;
        content_text: string | null;
      }[]
    )
      .filter((m) => m.content_text && m.content_text.trim())
      .reverse();
    if (rows.length < 5) return;

    const transcript = rows
      .map((r) => {
        const who =
          r.sender_type === 'customer'
            ? 'Cliente'
            : r.sender_type === 'bot'
              ? 'IA'
              : 'Agente';
        return `${who}: ${r.content_text!.trim()}`;
      })
      .join('\n');

    const prior = contact.ai_summary
      ? `Resumen previo del cliente (mantené lo útil y actualizá):\n${contact.ai_summary}\n\n`
      : '';

    const client = getAnthropic(apiKey, {
      db,
      workspaceId: conversation.workspace_id,
      concepto: 'ia_resumen',
      origenDeLaClave: clave.source,
    });
    const res = await client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 350,
      system:
        'Sos un compresor de memoria de cliente. Devolvés UN solo párrafo en español de máximo 150 palabras describiendo al cliente: nombre si se sabe, preferencias, alergias / restricciones, productos que le interesan, tono que usa (formal/casual), tipo de consultas frecuentes. Sin viñetas, sin saludos.',
      messages: [
        {
          role: 'user',
          content: `${prior}Transcripto reciente:\n${transcript}`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) return;

    await db
      .from('contacts')
      .update({
        ai_summary: text,
        last_ai_conversation_at: new Date().toISOString(),
      })
      .eq('id', contact.id);
  } catch (err) {
    console.error('[ai/summarize] contact summarize failed:', err);
  }
}
