import type { SupabaseClient } from '@supabase/supabase-js';
import type { Channel } from '@/types';
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
 */
export async function aQuienAvisar(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data: ws } = await db
    .from('workspaces')
    .select('alert_phone, owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  const fila = ws as { alert_phone?: string | null; owner_id?: string | null } | null;
  const propio = soloDigitos(fila?.alert_phone);
  if (propio) return propio;

  // EL NÚMERO CONECTADO DE LA CUENTA. Es el que trabaja: la bandeja de ese
  // número es donde está la gente que puede meterse en el caso. El teléfono
  // personal del dueño queda de respaldo para las cuentas que usan Riverz sin
  // WhatsApp (sólo Instagram, sólo correo), no como primera opción: un aviso
  // de operación tiene que caer en la línea del negocio.
  const conectado = await numeroConectado(db, workspaceId);
  if (conectado) return conectado;

  const { data: miembros } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);
  const ids = ((miembros ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  if (fila?.owner_id && !ids.includes(fila.owner_id)) ids.push(fila.owner_id);

  if (ids.length > 0) {
    const { data: perfiles } = await db
      .from('profiles')
      .select('user_id, phone')
      .in('user_id', ids)
      .not('phone', 'is', null);
    const conTelefono = ((perfiles ?? []) as Array<{ user_id: string; phone: string }>)
      .filter((p) => soloDigitos(p.phone));
    const delDuenio = conTelefono.find((p) => p.user_id === fila?.owner_id);
    const elegido = delDuenio ?? conTelefono[0];
    if (elegido) return soloDigitos(elegido.phone);
  }

  return null;
}

/**
 * EL NÚMERO DE WHATSAPP QUE LA CUENTA TIENE CONECTADO.
 *
 * Es el que nunca falta. Un comercio puede no haber cargado su teléfono en el
 * perfil —medido el 2026-08-28: 8 de 10 cuentas no lo tenían, así que sus
 * casos escalados no le llegaban a nadie— pero si usa Riverz para WhatsApp
 * tiene un número conectado sí o sí, y es un número que alguien mira.
 *
 * El aviso sale desde el WhatsApp de la plataforma, no desde el del comercio,
 * así que esto es una conversación normal entre dos números distintos.
 *
 * Se descartan los desconectados: escribirle a un número que el comercio dejó
 * de usar es no avisar, con el agravante de que el registro dice que sí.
 */
async function numeroConectado(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await db
    .from('channel_connections')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'whatsapp')
    .eq('status', 'connected');
  for (const fila of (data ?? []) as Array<{
    config: Record<string, unknown> | null;
  }>) {
    const numero = soloDigitos(
      (fila.config?.display_phone_number as string | undefined) ?? null,
    );
    if (numero) return numero;
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

    const { destinosDeAviso, avisarATodos } = await import('@/lib/avisos/destinos');
    const telefonos = await destinosDeAviso(db, d.workspaceId, 'operacion');
    const telefono = telefonos[0] ?? null;
    if (!telefono) {
      console.warn(
        '[escalada] hay un caso para una persona y no hay a quién avisarle:',
        d.workspaceId,
      );
      await soltar();
      return { avisado: false, motivo: 'sin número de aviso' };
    }

    const { titulo, cuerpo } = textoDelAviso(d);
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

/**
 * TODOS los teléfonos a los que este comercio quiere que le avisen.
 *
 * Un comercio con turnos no tiene un solo responsable: a las once de la noche
 * el aviso le llega a quien está durmiendo y el que está trabajando no se
 * entera. Por eso hay hasta tres —el dueño, el encargado y un suplente— y por
 * eso no hay más: cuatro deja de ser un aviso y pasa a ser una difusión.
 *
 * Sale sin repetidos: se comparan por dígitos, así que «+54 9 11…» y
 * «5491161047646» cuentan como uno. Si nadie configuró números propios, cae al
 * que ya resuelve `aQuienAvisar` — el de la línea del negocio.
 */
export async function telefonosDeAviso(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const digitos = (t: string) => t.replace(/\D/g, '');
  const salida = new Map<string, string>();

  const { data: ws } = await db
    .from('workspaces')
    .select('alert_phone, alert_phones')
    .eq('id', workspaceId)
    .maybeSingle();
  const fila = ws as {
    alert_phone?: string | null;
    alert_phones?: string[] | null;
  } | null;

  for (const t of [fila?.alert_phone ?? '', ...(fila?.alert_phones ?? [])]) {
    const limpio = (t ?? '').trim();
    if (limpio && digitos(limpio)) salida.set(digitos(limpio), limpio);
  }

  if (salida.size === 0) {
    const uno = await aQuienAvisar(db, workspaceId);
    if (uno && digitos(uno)) salida.set(digitos(uno), uno);
  }

  return [...salida.values()];
}
