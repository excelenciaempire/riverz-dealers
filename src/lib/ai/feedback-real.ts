import type { SupabaseClient } from '@supabase/supabase-js';
import type { ItemGuardado } from '@/lib/ai/sesiones-de-prueba';

/**
 * El feedback del equipo sobre respuestas automáticas en conversaciones
 * reales (la bandeja).
 *
 * Se guarda con su "captura": el tramo de conversación que terminaba en esa
 * respuesta, como se veía en ese momento. El hilo sigue creciendo y hasta se
 * puede borrar; lo que se juzgó tiene que poder releerse igual, en la pantalla
 * del comercio y en el panel de Riverz.
 */

const ORIGENES_AUTOMATICOS = new Set(['ai_agent', 'comment_ai', 'automation', 'voice_agent', 'order_update']);

/** Feedback concerns Riverz/team replies, never inbound customer messages. */
export function admiteFeedbackReal(m: { sender_type: string | null }): boolean {
  return ['agent', 'bot'].includes(m.sender_type ?? '');
}

export function feedbackGroupEnd(messages: Array<{sender_type:string|null;deleted_at?:string|null;content_text?:string|null}>,index:number):boolean {
  const current=messages[index];
  if(!current||current.deleted_at||current.content_text==='[deleted]'||!admiteFeedbackReal(current))return false;
  const next=messages.slice(index+1).find(m=>!m.deleted_at&&m.content_text!=='[deleted]'&&
    !(m.sender_type==='agent'&&/replied to (an|your) ad|respondió a (un|tu) anuncio/i.test(m.content_text??'')));
  return !next||!admiteFeedbackReal(next);
}

/** Sólo se opina sobre lo que mandó Riverz solo, no sobre lo que escribió una persona. */
export function esMensajeAutomatico(m: { sender_type: string | null; origin: string | null; sender_id?: string | null }): boolean {
  if (m.sender_type === 'bot') return true;
  return m.sender_type === 'agent' && !m.sender_id && ORIGENES_AUTOMATICOS.has(String(m.origin ?? ''));
}

interface FilaDeMensaje {
  id: string;
  created_at: string;
  sender_type: string | null;
  sender_id: string | null;
  origin: string | null;
  template_name: string | null;
  content_text: string | null;
}

const LARGO_DE_CAPTURA = 12;

function quien(m: FilaDeMensaje): string {
  if (m.template_name) return m.template_name;
  if (m.origin === 'ai_agent' || m.origin === 'comment_ai') return 'IA';
  if (m.origin === 'automation') return 'Automatización';
  if (m.sender_type === 'agent') return 'Equipo';
  return 'Riverz';
}

/** Sin hora en cada burbuja: la captura se muestra con la fecha del feedback, en la zona de quien mira. */
export function filasACaptura(filas: FilaDeMensaje[]): ItemGuardado[] {
  return filas.map((m): ItemGuardado =>
    m.sender_type === 'customer'
      ? { k: 'me', texto: m.content_text?.trim() || '[adjunto]' }
      : { k: 'biz', texto: m.content_text?.trim() || '[adjunto]', nota: quien(m) }
  );
}

/** El tramo que termina en el mensaje juzgado, con la respuesta al final. */
export async function capturaHasta(
  admin: SupabaseClient,
  conversationId: string,
  mensaje: { id: string; created_at: string }
): Promise<ItemGuardado[]> {
  const { data } = await admin
    .from('messages')
    .select('id, created_at, sender_type, sender_id, origin, template_name, content_text')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .lte('created_at', mensaje.created_at)
    .order('created_at', { ascending: false })
    .limit(LARGO_DE_CAPTURA + 5);
  const filas = ((data ?? []) as FilaDeMensaje[])
    // Los que comparten segundo con el juzgado pero llegaron después no son parte.
    .filter((m) => m.created_at < mensaje.created_at || m.id === mensaje.id)
    .slice(0, LARGO_DE_CAPTURA)
    .reverse();
  return filasACaptura(filas);
}
