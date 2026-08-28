import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '@/types';
import { sendPlatformAlert } from '@/lib/admin/platform-whatsapp';
import type { Escalada } from './escalada';

/**
 * EL AVISO POR WHATSAPP CUANDO UN CASO NECESITA UNA PERSONA.
 *
 * Marcar el hilo como "necesita persona" ya se hacía; el problema es que sólo
 * se ve entrando a la bandeja. Un envío que va a la ciudad equivocada se
 * arregla en la hora siguiente o no se arregla, y nadie mira la bandeja a las
 * dos de la mañana.
 *
 * El aviso está escrito para que quien lo recibe pueda meterse SIN abrir nada:
 * quién es, por dónde escribe, qué pasó, con qué palabras lo dijo, qué pedido
 * es y a dónde ir. Un aviso que dice "tenés un caso para revisar" obliga a
 * buscar todo eso de nuevo, y a esa hora se posterga.
 *
 * Sale UNA vez por conversación escalada (lo garantiza `avisado_at`): el mismo
 * problema avisado tres veces enseña a ignorar el cuarto.
 */

/** Todo lo que hace falta para entender el caso sin abrir la app. */
export interface DatosDelCaso {
  workspaceId: string;
  conversationId: string;
  /** Cómo se llama, tal como figura en la bandeja. */
  cliente: string | null;
  /** Su teléfono o usuario, para poder contestarle directo. */
  contacto: string | null;
  canal: Channel | string;
  escalada: Escalada;
  /** Lo último que escribió, textual. Es lo que más rápido explica el caso. */
  ultimoMensaje: string | null;
  /** El pedido en juego, si el hilo estaba mirando uno. */
  pedido?: { numero?: string | null; estado?: string | null } | null;
  /** Desde cuándo viene esperando, en horas. */
  esperandoHoras?: number | null;
}

const CANALES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  ig_comment: 'un comentario de Instagram',
  fb_comment: 'un comentario de Facebook',
  tiktok_comment: 'un comentario de TikTok',
  mercadolibre: 'Mercado Libre',
  webchat: 'el chat de la web',
  gmail: 'correo',
  outlook: 'correo',
  voice: 'una llamada',
};

/**
 * El texto del aviso.
 *
 * Se arma acá y no en el prompt de un modelo a propósito: un aviso tiene que
 * decir siempre lo mismo en el mismo orden, para que se lea de un vistazo a
 * las tres de la mañana. Y tiene que salir aunque el modelo esté caído, que es
 * justo cuando más casos se escapan.
 *
 * Las líneas que no tienen dato NO se escriben: un aviso con "Pedido: —" gasta
 * un renglón en decir que no sabe.
 */
export function textoDelAviso(d: DatosDelCaso): { titulo: string; cuerpo: string } {
  const nombre = (d.cliente ?? '').trim() || 'Un cliente';
  const canal = CANALES[String(d.canal)] ?? String(d.canal);
  const urgente = d.escalada.urgencia === 'ahora';

  const titulo = urgente
    ? `${nombre} necesita que alguien entre ahora`
    : `${nombre} necesita que alguien la atienda`;

  const cuerpo = [
    `Qué pasa: ${d.escalada.porQue}.`,
    `Escribe por ${canal}${d.contacto ? ` (${d.contacto})` : ''}.`,
    d.ultimoMensaje?.trim()
      ? `Sus palabras: "${d.ultimoMensaje.trim().replace(/\s+/g, ' ').slice(0, 220)}"`
      : null,
    d.pedido?.numero
      ? `Pedido ${d.pedido.numero}${d.pedido.estado ? ` · ${d.pedido.estado}` : ''}.`
      : null,
    typeof d.esperandoHoras === 'number' && d.esperandoHoras >= 1
      ? `Viene esperando hace ${Math.round(d.esperandoHoras)} h.`
      : null,
    '',
    `Abrí la conversación: ${enlaceDelHilo(d.conversationId)}`,
    'El asistente ya dejó de contestarle: lo que escribas vos es lo próximo que lee.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { titulo, cuerpo };
}

function enlaceDelHilo(conversationId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co';
  return `${base}/bandeja?c=${conversationId}`;
}

/**
 * A quién se le avisa.
 *
 * Primero el número que el comercio cargó para avisos; si no puso ninguno, el
 * del dueño de la cuenta, que es el que ya tenemos. Sin ninguno de los dos no
 * se avisa — y se deja dicho en el log, porque "no salió" y "no había a quién"
 * son cosas distintas y sólo una se arregla sola.
 */
async function aQuienAvisar(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data: ws } = await db
    .from('workspaces')
    .select('alert_phone, owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  const fila = ws as { alert_phone?: string | null; owner_id?: string | null } | null;
  const propio = (fila?.alert_phone ?? '').trim();
  if (propio) return propio;
  if (!fila?.owner_id) return null;
  const { data: perfil } = await db
    .from('profiles')
    .select('phone')
    .eq('id', fila.owner_id)
    .maybeSingle();
  return ((perfil as { phone?: string | null } | null)?.phone ?? '').trim() || null;
}

/**
 * Avisa, una sola vez por conversación. Best-effort de punta a punta: que no
 * salga el aviso no puede tumbar la respuesta que lo originó.
 */
export async function avisarEscalada(
  db: SupabaseClient,
  d: DatosDelCaso,
): Promise<{ avisado: boolean; motivo?: string }> {
  try {
    // Una vez por conversación. El candado es la propia fila: se marca ANTES
    // de mandar, así dos caminos que escalan el mismo hilo a la vez no avisan
    // dos veces.
    const { data: reservado } = await db
      .from('conversations')
      .update({ needs_human_avisado_at: new Date().toISOString() })
      .eq('id', d.conversationId)
      .is('needs_human_avisado_at', null)
      .select('id')
      .maybeSingle();
    if (!reservado) return { avisado: false, motivo: 'ya se había avisado' };

    const telefono = await aQuienAvisar(db, d.workspaceId);
    if (!telefono) {
      console.warn(
        '[escalada] hay un caso para una persona y no hay a quién avisarle:',
        d.workspaceId,
      );
      return { avisado: false, motivo: 'sin número de aviso' };
    }

    const { titulo, cuerpo } = textoDelAviso(d);
    const res = await sendPlatformAlert({ to: telefono, title: titulo, body: cuerpo });
    if (!res.ok) {
      console.warn('[escalada] no se pudo avisar por WhatsApp:', res.error);
      return { avisado: false, motivo: res.error };
    }
    return { avisado: true };
  } catch (err) {
    console.error('[escalada] el aviso falló:', err);
    return { avisado: false, motivo: 'error' };
  }
}
