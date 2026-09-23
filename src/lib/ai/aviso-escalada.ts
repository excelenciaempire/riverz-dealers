import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '@/types';
import type { Escalada } from './escalada';
import type { Locale } from '@/lib/i18n/config';
import { localeDeCuenta } from '@/lib/i18n/cuenta';
import { translate } from '@/lib/i18n/translate';
import { compactarConversationId } from '@/lib/avisos/enlace-conversacion';

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
  ig_comment: 'Instagram',
  fb_comment: 'Facebook',
  tiktok_comment: 'TikTok',
  mercadolibre: 'Mercado Libre',
  webchat: 'Webchat',
  gmail: 'Gmail',
  outlook: 'Outlook',
  voice: 'Voice',
};

function limpiarFrase(valor: string): string {
  return valor
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:·]+$/g, '')
    .trim();
}

function resumenDelMensaje(valor: string, locale: Locale): string {
  const limpio = limpiarFrase(valor).slice(0, 180);
  if (/^\[(imagen|image)\]$/i.test(limpio)) {
    return translate(locale, 'settings.avisoEscaladaImagen');
  }
  return limpio;
}

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
export function textoDelAviso(
  d: DatosDelCaso,
  locale: Locale = 'es'
): { titulo: string; cuerpo: string } {
  const nombre =
    (d.cliente ?? '').trim() ||
    translate(locale, 'settings.avisoEscaladaCliente');
  const canal = CANALES[String(d.canal)] ?? String(d.canal);
  const urgente = d.escalada.urgencia === 'ahora';

  const titulo = translate(
    locale,
    urgente
      ? 'settings.avisoEscaladaUrgenteTitulo'
      : 'settings.avisoEscaladaTitulo',
    { cliente: nombre }
  );

  const cuerpo = [
    translate(locale, 'settings.avisoEscaladaMotivo', {
      motivo: limpiarFrase(d.escalada.porQue),
    }),
    translate(locale, 'settings.avisoEscaladaCanal', {
      canal,
      contacto: d.contacto ? ` · ${d.contacto}` : '',
    }),
    d.ultimoMensaje?.trim()
      ? translate(locale, 'settings.avisoEscaladaUltimoMensaje', {
          mensaje: resumenDelMensaje(d.ultimoMensaje, locale),
        })
      : null,
    d.pedido?.numero
      ? translate(locale, 'settings.avisoEscaladaPedido', {
          pedido: d.pedido.numero,
          estado: d.pedido.estado ? ` · ${d.pedido.estado}` : '',
        })
      : null,
    typeof d.esperandoHoras === 'number' && d.esperandoHoras >= 1
      ? translate(locale, 'settings.avisoEscaladaEspera', {
          horas: Math.round(d.esperandoHoras),
        })
      : null,
    '',
    translate(locale, 'settings.avisoEscaladaAbrir', {
      enlace: enlaceDelHilo(d.conversationId),
    }),
    translate(locale, 'settings.avisoEscaladaPausa'),
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { titulo, cuerpo };
}

function enlaceDelHilo(conversationId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co';
  const token = compactarConversationId(conversationId);
  return token ? `${base}/i/${token}` : `${base}/bandeja?c=${conversationId}`;
}

/**
 * A quién se le avisa.
 *
 * El número sale de Ajustes → Perfil → WhatsApp, que es el campo que el
 * comercio ya llena y cuyo texto dice exactamente esto: "a este número te
 * preguntamos lo que la IA no decide sola".
 *
 * Se busca por `profiles.user_id`, NO por `profiles.id`: son dos columnas
 * distintas y `id` es la clave de la fila, no la del usuario. Buscar por `id`
 * —que es lo que hacía la primera versión— no encontraba a nadie nunca, así
 * que el aviso quedaba escrito y no salía jamás.
 *
 * Primero el dueño de la cuenta; si no cargó el suyo, cualquier miembro que sí.
 * Y `workspaces.alert_phone` gana sobre todo, para el comercio que quiera
 * mandar los avisos a otro lado (el encargado de turno, un grupo de guardia).
 *
 * **Nunca la línea conectada del comercio.** Fue el respaldo hasta hoy y era un
 * pozo: el número de `channel_connections` es una línea de la Cloud API, no un
 * teléfono. Meta no le entrega el aviso a ninguna persona — lo devuelve por el
 * webhook como `type: unsupported`, o sea que el aviso entra a la bandeja del
 * propio comercio como si un cliente hubiera mandado algo ilegible. Medido el
 * 2026-08-30 en la cuenta Pilar: 9 de 9 escaladas del día terminaron ahí, la IA
 * le contestó a una y volvió a escalar. El aviso que se manda a uno mismo no es
 * un aviso.
 */
export async function aQuienAvisar(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data: ws } = await db
    .from('workspaces')
    .select('alert_phone, owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  const fila = ws as {
    alert_phone?: string | null;
    owner_id?: string | null;
  } | null;
  const propio = soloDigitos(fila?.alert_phone);
  if (propio) return propio;

  const { data: miembros } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);
  const ids = ((miembros ?? []) as Array<{ user_id: string }>).map(
    (m) => m.user_id
  );
  if (fila?.owner_id && !ids.includes(fila.owner_id)) ids.push(fila.owner_id);

  if (ids.length > 0) {
    const { data: perfiles } = await db
      .from('profiles')
      .select('user_id, phone')
      .in('user_id', ids)
      .not('phone', 'is', null);
    const conTelefono = (
      (perfiles ?? []) as Array<{ user_id: string; phone: string }>
    ).filter((p) => soloDigitos(p.phone));
    const delDuenio = conTelefono.find((p) => p.user_id === fila?.owner_id);
    const elegido = delDuenio ?? conTelefono[0];
    if (elegido) return soloDigitos(elegido.phone);
  }

  return null;
}

/**
 * Meta quiere el número en dígitos. Los que guardamos vienen como los devuelve
 * cada integración —"+54 9 11 7678-3848"— y con espacios y guiones el envío
 * falla, que es la peor forma de fallar: en silencio.
 */
function soloDigitos(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').replace(/\D/g, '');
  return limpio.length >= 8 ? limpio : null;
}

/**
 * Avisa, una sola vez por conversación. Best-effort de punta a punta: que no
 * salga el aviso no puede tumbar la respuesta que lo originó.
 */
export async function avisarEscalada(
  db: SupabaseClient,
  d: DatosDelCaso
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

    // Si de acá en adelante algo falla hay que SOLTAR la reserva. La marca
    // dice "ya se avisó" y es lo que impide un segundo intento: dejarla
    // puesta sobre un envío que no salió es perder el aviso para siempre, y
    // encima el registro queda diciendo que se mandó. Es exactamente el caso
    // en que hace falta reintentar.
    const soltar = async () => {
      await db
        .from('conversations')
        .update({ needs_human_avisado_at: null })
        .eq('id', d.conversationId);
    };

    const { destinosDeAviso, avisarATodos } =
      await import('@/lib/avisos/destinos');
    const telefonos = await destinosDeAviso(db, d.workspaceId, 'operacion');
    const telefono = telefonos[0] ?? null;
    if (!telefono) {
      console.warn(
        '[escalada] hay un caso para una persona y no hay a quién avisarle:',
        d.workspaceId
      );
      await soltar();
      return { avisado: false, motivo: 'sin número de aviso' };
    }

    const locale = await localeDeCuenta(db, d.workspaceId);
    const { titulo, cuerpo } = textoDelAviso(d, locale);
    // A todos los que el comercio cargó: en un turno de noche el que puede
    // meterse en el caso no es siempre el mismo.
    const res = await avisarATodos(telefonos, { title: titulo, body: cuerpo });
    if (!res.ok) {
      console.warn('[escalada] no se pudo avisar por WhatsApp:', res.error);
      await soltar();
      return { avisado: false, motivo: res.error };
    }
    return { avisado: true };
  } catch (err) {
    console.error('[escalada] el aviso falló:', err);
    // Mismo motivo: sin soltar la reserva, un error de red se lleva puesto el
    // aviso y nadie se entera nunca.
    try {
      await db
        .from('conversations')
        .update({ needs_human_avisado_at: null })
        .eq('id', d.conversationId);
    } catch {
      /* si tampoco se puede soltar, ya se registró el error de arriba */
    }
    return { avisado: false, motivo: 'error' };
  }
}
