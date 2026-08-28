import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel, ChannelConnection, Conversation } from "@/types";
import { decrypt } from "./encryption";

/**
 * DE QUÉ HABLA ESTA PERSONA — en los canales donde no es un comentario.
 *
 * Un comentario cuelga de una publicación y eso ya está resuelto
 * (`publicacion.ts`). Pero hay más superficies donde la persona escribe SOBRE
 * algo concreto y el agente lo ignoraba por completo:
 *
 *   Mercado Libre  — una pregunta (y una opinión: viajan por el mismo canal)
 *                    cuelga de una publicación. "¿Viene en talle L?" no dice
 *                    de QUÉ, porque en ML eso lo dice la página donde se
 *                    escribió. El agente leía la pregunta suelta.
 *   Un anuncio     — quien llega por un anuncio de Meta (click-to-WhatsApp,
 *                    Instagram, Messenger) escribe "hola, info" y ya. El
 *                    anuncio que hizo clic —su titular, su texto, a qué página
 *                    llevaba— se guarda desde hace tiempo en
 *                    `conversations.ad_referral` para atribuir la venta, y
 *                    nadie se lo estaba dando al agente. Es literalmente la
 *                    promesa que la persona vino a cobrar.
 *
 * Best-effort en todos los caminos: sin dato devuelve null y el prompt queda
 * como estaba.
 */

const ML = "https://api.mercadolibre.com";

/**
 * El bloque para el prompt, o null. Se llama para CUALQUIER canal: cada rama
 * decide si tiene algo que aportar.
 */
export async function briefDeQueHabla(
  db: SupabaseClient,
  conversation: Conversation,
): Promise<string | null> {
  try {
    const partes = [
      await briefDelAnuncio(conversation),
      conversation.channel === "mercadolibre"
        ? await briefDeLaPublicacionML(db, conversation)
        : null,
    ].filter(Boolean);
    return partes.length > 0 ? partes.join("\n\n") : null;
  } catch {
    return null;
  }
}

/**
 * El anuncio por el que llegó.
 *
 * Lo que el anuncio prometía es lo que la persona vino a cobrar: sin esto el
 * agente contesta "¿en qué te ayudo?" a alguien que acaba de ver un video de
 * un producto concreto con un descuento concreto.
 */
async function briefDelAnuncio(conversation: Conversation): Promise<string | null> {
  const ref = (conversation as { ad_referral?: unknown }).ad_referral as
    | {
        headline?: string | null;
        body?: string | null;
        sourceUrl?: string | null;
        source_url?: string | null;
        mediaType?: string | null;
      }
    | null
    | undefined;
  if (!ref || typeof ref !== "object") return null;

  const titular = (ref.headline ?? "").trim();
  const cuerpo = (ref.body ?? "").trim();
  const url = (ref.sourceUrl ?? ref.source_url ?? "").trim();
  if (!titular && !cuerpo && !url) return null;

  return [
    "## El anuncio por el que escribió",
    "Esta persona no escribió de la nada: hizo clic en un anuncio de la tienda y el chat se abrió ahí mismo. Lo que el anuncio prometía es lo que viene a preguntar, aunque su primer mensaje sea sólo un “hola”.",
    titular ? `Titular del anuncio: ${titular.slice(0, 300)}` : null,
    cuerpo ? `Texto del anuncio: ${cuerpo.slice(0, 600)}` : null,
    url ? `Llevaba a: ${url.slice(0, 300)}` : null,
    "Da por hecho que pregunta por ESO y arranca desde ahí, sin pedirle que repita lo que ya vio. El precio y la disponibilidad salen de la ficha del producto, no del anuncio: un anuncio puede ser viejo.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * La publicación de Mercado Libre sobre la que preguntan.
 *
 * En ML la pregunta se escribe DENTRO de la publicación, así que casi nunca
 * dice de qué producto habla: lo obvio no se escribe. El id del ítem viaja en
 * el asunto del hilo ("Pregunta · MLA123"), que es donde lo dejó el poll.
 */
async function briefDeLaPublicacionML(
  db: SupabaseClient,
  conversation: Conversation,
): Promise<string | null> {
  const itemId = itemDelAsunto(conversation.subject);
  if (!itemId) return null;

  const token = await tokenML(db, conversation);
  if (!token) return null;

  const res = await fetch(
    `${ML}/items/${encodeURIComponent(itemId)}?attributes=title,price,currency_id,available_quantity,permalink,attributes`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const item = (await res.json().catch(() => ({}))) as {
    title?: string;
    price?: number;
    currency_id?: string;
    available_quantity?: number;
    permalink?: string;
    attributes?: Array<{ name?: string; value_name?: string | null }>;
  };
  if (!item.title) return null;

  // Las fichas técnicas de ML son la respuesta a la mitad de las preguntas
  // (medidas, material, modelo compatible), y están ahí mismo.
  const fichas = (item.attributes ?? [])
    .filter((a) => a.name && a.value_name)
    .slice(0, 12)
    .map((a) => `- ${a.name}: ${a.value_name}`);

  return [
    "## La publicación sobre la que preguntan",
    "Esta pregunta se escribió DENTRO de una publicación de Mercado Libre. La persona no dice de qué producto habla porque en su pantalla es obvio: es este.",
    `Producto: ${item.title}`,
    typeof item.price === "number"
      ? `Precio publicado: ${item.price} ${item.currency_id ?? ""}`.trim()
      : null,
    typeof item.available_quantity === "number"
      ? `Disponibles: ${item.available_quantity}`
      : null,
    fichas.length > 0 ? `Ficha de la publicación:\n${fichas.join("\n")}` : null,
    "Contesta sobre ESTE producto sin preguntarle cuál es. Y no contradigas la publicación: el precio y el stock que ve la persona son los de arriba.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** "Pregunta · MLA123456" → "MLA123456". */
export function itemDelAsunto(subject: string | null | undefined): string | null {
  const s = String(subject ?? "").trim();
  if (!s) return null;
  const m = s.match(/\b(ML[A-Z]\d{6,})\b/);
  return m ? m[1] : null;
}

async function tokenML(
  db: SupabaseClient,
  conversation: Conversation,
): Promise<string | null> {
  if (!conversation.connection_id) return null;
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("id", conversation.connection_id)
    .maybeSingle();
  const conn = data as ChannelConnection | null;
  if (!conn) return null;
  const secrets = (conn.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!enc) return null;
  try {
    return decrypt(enc) || null;
  } catch {
    return null;
  }
}

/** Igual, partiendo del id: el runner conoce la conversación por id. */
export async function briefDeQueHablaPorId(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  const conv = data as Conversation | null;
  return conv ? briefDeQueHabla(db, conv) : null;
}

/** Los canales donde esto puede aportar algo. Evita una consulta en los demás. */
export function puedeAportarContexto(channel: Channel): boolean {
  return (
    channel === "mercadolibre" ||
    channel === "whatsapp" ||
    channel === "instagram" ||
    channel === "messenger"
  );
}
