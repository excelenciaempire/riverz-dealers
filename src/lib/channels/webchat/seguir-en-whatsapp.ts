/**
 * Del chat de la web a WhatsApp, sin perder la conversación.
 *
 * Cada canal tiene una salida al canal de al lado cuando el suyo se le queda
 * corto: la llamada manda un WhatsApp con el link que no se puede dictar, el
 * comentario público sigue por DM. El chat web no tenía ninguna — quien
 * escribía ahí era un visitante anónimo, cerraba la pestaña y ahí se terminaba
 * todo: ni el comercio podía retomarlo ni la persona podía volver.
 *
 * Cómo funciona:
 *   1. El visitante toca "Seguir por WhatsApp".
 *   2. Se emite un código de un solo uso y se abre wa.me con un mensaje ya
 *      escrito que lo lleva.
 *   3. La persona manda ese mensaje. Lo INICIA ella, así que no hace falta
 *      plantilla aprobada y la ventana de 24 h se abre sola.
 *   4. El webhook ve el código, une las dos fichas y el agente sigue la
 *      conversación con todo lo que ya se habló — `loadContext` junta los
 *      hilos de la misma persona desde hace rato.
 *
 * Sobre la identidad: el código prueba que quien escribe por WhatsApp tenía
 * abierta esa sesión del chat web. Es identidad probada por el CANAL, no un
 * dato afirmado — de ahí que unir acá sea seguro y unir por un correo tipeado
 * no lo sea (ver `identidad-probada.ts`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import type { Contact } from '@/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('webchat.whatsapp');

/** Vale un día. Lo que no se usa hoy no se usa nunca. */
const VENCE_MS = 24 * 60 * 60 * 1000;

/**
 * El código, tal como viaja en el mensaje.
 *
 * Corto para que no ensucie lo que la persona ve escrito, y aleatorio para que
 * no se pueda adivinar: quien acierte un código se queda con la conversación
 * web de otro. Sin ambigüedades tipográficas (nada de O/0, I/l): alguien lo va
 * a tipear a mano alguna vez.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function nuevoCodigo(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += ALFABETO[b % ALFABETO.length];
  return out;
}

/** Cómo se reconoce el código dentro del mensaje que llega por WhatsApp. */
const MARCA = /\bRZ-([A-HJ-NP-Z2-9]{10})\b/;

export function codigoEnTexto(texto: string | null | undefined): string | null {
  const m = MARCA.exec((texto ?? '').toUpperCase());
  return m ? m[1] : null;
}

/**
 * El número del comercio, para armar el wa.me.
 *
 * `whatsapp_config` guarda el `phone_number_id`, que sirve para enviar pero no
 * es un número: hay que preguntárselo a Meta. Se cachea en memoria porque un
 * comercio no cambia de número, y una consulta al Graph por cada visitante que
 * abre el chat sería una consulta de más en el camino más caliente.
 */
const cacheNumero = new Map<string, { at: number; numero: string | null }>();
const CACHE_MS = 60 * 60_000;
/**
 * Un "todavía no" se olvida rápido.
 *
 * Un comercio que acaba de conectar WhatsApp —o que acaba de renovar un token
 * vencido— no puede esperar una hora para que el botón funcione: en ese rato
 * mira la pantalla, ve que no anda y concluye que el producto está roto. El
 * resultado bueno sí se cachea largo: un número no cambia.
 */
const CACHE_NEGATIVO_MS = 60_000;

export async function numeroDelComercio(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const hit = cacheNumero.get(workspaceId);
  if (hit && Date.now() - hit.at < (hit.numero ? CACHE_MS : CACHE_NEGATIVO_MS)) {
    return hit.numero;
  }

  let numero: string | null = null;
  try {
    const { data } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    const cfg = data as {
      phone_number_id?: string;
      access_token?: string;
      status?: string;
    } | null;
    if (cfg?.phone_number_id && cfg.access_token && cfg.status !== 'disconnected') {
      const token = decrypt(cfg.access_token);
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${cfg.phone_number_id}?fields=display_phone_number`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) {
        const j = (await r.json()) as { display_phone_number?: string };
        const solo = (j.display_phone_number ?? '').replace(/\D/g, '');
        numero = solo.length >= 8 ? solo : null;
      }
    }
  } catch (e) {
    log.captureException(e, { workspaceId });
  }

  cacheNumero.set(workspaceId, { at: Date.now(), numero });
  return numero;
}

/**
 * ¿Hay WhatsApp conectado? Sin la vuelta al Graph.
 *
 * Esto se pregunta al abrir CADA sesión del widget, así que no puede costar una
 * llamada a Meta: sólo mira si la fila existe. El número —que sí requiere el
 * Graph— se resuelve recién cuando alguien toca el botón.
 */
const cacheTiene = new Map<string, { at: number; tiene: boolean }>();

export async function tieneWhatsApp(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const hit = cacheTiene.get(workspaceId);
  if (hit && Date.now() - hit.at < (hit.tiene ? CACHE_MS : CACHE_NEGATIVO_MS)) {
    return hit.tiene;
  }
  const { data } = await db
    .from('whatsapp_config')
    .select('phone_number_id, status')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  // Desconectado cuenta como no tener: el webhook de Meta descarta TODO lo
  // entrante en silencio, así que la persona escribiría a un número donde
  // nadie la lee. Un `status` nulo es de antes de que existiera la columna y
  // se toma como conectado — es lo que hace el resto del sistema.
  const cfg = data as { phone_number_id?: string; status?: string } | null;
  const tiene = !!cfg?.phone_number_id && cfg.status !== 'disconnected';
  cacheTiene.set(workspaceId, { at: Date.now(), tiene });
  return tiene;
}

export interface Traspaso {
  /** El link que abre WhatsApp con el mensaje ya escrito. */
  url: string;
  /** El código emitido, por si hace falta mostrarlo. */
  codigo: string;
}

/**
 * Emite el código y arma el link.
 *
 * Devuelve null cuando el comercio no tiene WhatsApp conectado: el botón no se
 * ofrece, que es mejor que ofrecer algo que no lleva a ningún lado.
 */
export async function crearTraspaso(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    contactId: string;
    conversationId: string | null;
    /** El texto que la persona va a mandar, sin el código. */
    saludo: string;
  },
): Promise<Traspaso | null> {
  const numero = await numeroDelComercio(db, args.workspaceId);
  if (!numero) return null;

  // Dos intentos: 31^10 hace que dos códigos iguales sean casi imposible, pero
  // "casi" acá significa que la persona toca el botón y no pasa nada. Un
  // reintento cuesta una consulta y elimina el caso.
  let codigo = '';
  for (let i = 0; i < 2 && !codigo; i++) {
    const intento = nuevoCodigo();
    const { error } = await db.from('webchat_handoffs').insert({
      code: intento,
      workspace_id: args.workspaceId,
      contact_id: args.contactId,
      conversation_id: args.conversationId,
    });
    if (!error) codigo = intento;
    else if ((error as { code?: string }).code !== '23505') {
      log.captureException(error, { workspaceId: args.workspaceId });
      return null;
    }
  }
  if (!codigo) return null;

  const texto = `${args.saludo} [RZ-${codigo}]`;
  return {
    codigo,
    url: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,
  };
}

/**
 * Llegó un WhatsApp con un código: une las dos fichas.
 *
 * Todo es best-effort y nada de esto puede tumbar la recepción de un mensaje:
 * si algo falla, el mensaje igual entra a la bandeja y lo único que se pierde
 * es el hilo anterior.
 *
 * Idempotente: un código ya reclamado no vuelve a unir nada. Meta reentrega
 * eventos, y la persona puede mandar el mismo mensaje dos veces.
 */
export async function reclamarTraspaso(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    texto: string | null | undefined;
    /** La ficha de WhatsApp de quien acaba de escribir. */
    contactoWhatsapp: Contact;
  },
): Promise<boolean> {
  const codigo = codigoEnTexto(args.texto);
  if (!codigo) return false;

  try {
    const { data } = await db
      .from('webchat_handoffs')
      .select('code, workspace_id, contact_id, created_at, claimed_at')
      .eq('code', codigo)
      .maybeSingle();
    const fila = data as {
      workspace_id: string;
      contact_id: string;
      created_at: string;
      claimed_at: string | null;
    } | null;
    if (!fila) return false;

    // Un código de OTRO comercio no une nada acá. El mensaje llega al número
    // de este comercio, así que un código ajeno o es un error de tipeo o es
    // alguien probando.
    if (fila.workspace_id !== args.workspaceId) return false;
    if (fila.claimed_at) return false;
    if (Date.now() - new Date(fila.created_at).getTime() > VENCE_MS) return false;

    // ── Todo lo que puede decir que NO, ANTES de quemar el código ──
    //
    // Marcar reclamado es irreversible: el código sirve una sola vez. Si se
    // marcaba primero y después algo no daba —el contacto sin teléfono, una
    // ficha que alguien separó a mano— quedaba un código quemado que no unió
    // nada, y la persona no tenía forma de reintentar salvo volver a la web.
    const probado = args.contactoWhatsapp.phone ?? null;
    if (!probado) return false;

    const { data: visitanteRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', fila.contact_id)
      .maybeSingle();
    const visitante = visitanteRow as
      | (Contact & { phone_origen?: string | null; union_bloqueada?: boolean | null })
      | null;
    if (!visitante) return false;

    // Una separación hecha a mano gana sobre cualquier prueba. Alguien del
    // comercio miró esas dos fichas y dijo que no son la misma persona.
    const wa = args.contactoWhatsapp as Contact & { union_bloqueada?: boolean | null };
    if (visitante.union_bloqueada || wa.union_bloqueada) return false;

    // Se pisa el teléfono que escribió a mano, no el que ya venía respaldado.
    // Uno tipeado en un chat vale menos que el número desde el que efectivamente
    // escribió; pero uno que salió de un pedido o de la tienda ya sostiene otras
    // uniones, y romperlas desde acá sería peor. Ante la duda, no se une.
    const pisable = !visitante.phone || visitante.phone_origen === 'afirmado';
    if (!pisable && !mismoTelefono(visitante.phone, probado)) return false;

    // ── Recién ahora se quema el código ──
    //
    // Condicional: dos entregas del mismo evento no pueden unir dos veces.
    const { data: tomado } = await db
      .from('webchat_handoffs')
      .update({
        claimed_at: new Date().toISOString(),
        claimed_contact_id: args.contactoWhatsapp.id,
      })
      .eq('code', codigo)
      .is('claimed_at', null)
      .select('code');
    if (!tomado || tomado.length === 0) return false;

    // El teléfono del visitante ya no es una afirmación: escribió DESDE ese
    // número. Es identidad del canal, igual que la de cualquier contacto de
    // WhatsApp (`identidad-probada.ts`).
    if (visitante.phone !== probado || visitante.phone_origen !== 'canal') {
      await db
        .from('contacts')
        .update({ phone: probado, phone_origen: 'canal' })
        .eq('id', visitante.id);
    }

    // Unir: a partir de acá el agente ve los dos hilos como una sola persona.
    await unirProbado(db, visitante.id, args.contactoWhatsapp.id);
    return true;
  } catch (e) {
    log.captureException(e, { workspaceId: args.workspaceId });
    return false;
  }
}

/** Dos teléfonos escritos distinto que son el mismo número. */
function mismoTelefono(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? '').replace(/\D/g, '');
  const db_ = (b ?? '').replace(/\D/g, '');
  if (!da || !db_) return false;
  // Por la cola: el "9" argentino y el prefijo de país se escriben de varias
  // formas para el mismo celular (ver el dedup de contactos de WhatsApp).
  const n = Math.min(8, da.length, db_.length);
  return da.slice(-n) === db_.slice(-n);
}

/**
 * Unir dos fichas cuando la identidad está PROBADA.
 *
 * No pasa por `linkUnifiedContact` a propósito. Esa función busca duplicados
 * por coincidencia de teléfono o correo y desconfía cuando los datos se
 * contradicen —dos correos distintos son un teléfono de familia, no una
 * persona—. Es la regla correcta cuando lo único que hay es una coincidencia.
 *
 * Acá no hay coincidencia: hay una prueba. La persona tenía esa sesión del chat
 * abierta y escribió desde su WhatsApp. Un correo distinto entre las dos fichas
 * —el que tipeó en la web y el de su cuenta de la tienda— no vuelve dudosa esa
 * prueba, y con la regla general la unión se caía justo ahí.
 *
 * Lo único que sigue ganando es una separación hecha a mano, que se comprueba
 * antes de llamar acá.
 */
async function unirProbado(
  db: SupabaseClient,
  visitanteId: string,
  whatsappId: string,
): Promise<void> {
  const { data } = await db
    .from('contacts')
    .select('id, unified_contact_id, created_at')
    .in('id', [visitanteId, whatsappId]);
  const filas = (data ?? []) as {
    id: string;
    unified_contact_id: string | null;
    created_at: string | null;
  }[];
  if (filas.length < 2) return;

  // La raíz de cada uno: si ya está colgado de un primario, es ése el que se
  // une, no la hoja. Unir hojas dejaría dos árboles apuntando cruzado.
  const raices = filas.map((f) => f.unified_contact_id ?? f.id);
  const [ra, rb] = raices;
  if (ra === rb) return; // ya eran la misma persona

  const { data: rootRows } = await db
    .from('contacts')
    .select('id, created_at')
    .in('id', [ra, rb]);
  const roots = ((rootRows ?? []) as { id: string; created_at: string | null }[]).sort(
    (x, y) =>
      new Date(x.created_at ?? 0).getTime() - new Date(y.created_at ?? 0).getTime(),
  );
  if (roots.length < 2) return;

  // El primario es el más viejo, como en todo el resto del sistema.
  const primario = roots[0].id;
  const otro = roots[1].id;

  // Todo lo que colgaba del otro árbol pasa a colgar del primario, y el otro
  // deja de ser raíz. Sin esto, las fichas hermanas quedaban apuntando a un
  // contacto que ya no es primario y el historial salía partido.
  await db.from('contacts').update({ unified_contact_id: primario }).eq('unified_contact_id', otro);
  await db.from('contacts').update({ unified_contact_id: primario }).eq('id', otro);
  await db.from('contacts').update({ unified_contact_id: null }).eq('id', primario);
}
