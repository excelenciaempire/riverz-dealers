import type { SupabaseClient } from "@supabase/supabase-js";
import { costForModel } from "@/lib/admin/cost";
import type { ChannelConnection } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { describeImage, toImageMediaType } from "@/lib/ai/llm-client";
import { resolveAnthropicKey } from "@/lib/ai/platform-key";
import { transcribeBuffer, transcripcionDisponible } from "@/lib/ai/transcribe";
import { cobrar } from "@/lib/wallet/saldo";

/**
 * QUÉ MUESTRA LA PUBLICACIÓN.
 *
 * En TikTok el agente ya no contesta a ciegas: se transcribe el audio del
 * video y con el guion arriba, "eso también es cuando se expone mucho al sol"
 * se entiende. En Instagram y Facebook leía sólo el TEXTO del post — y en
 * Instagram el texto suele ser tres palabras y un emoji: lo que la persona
 * comenta es la FOTO. "¿El de la izquierda viene en talla M?" no significa
 * nada sin ver la foto, y el agente terminaba pidiendo "más contexto" a
 * alguien que ya lo había dado todo.
 *
 * Acá se resuelve una vez por publicación: la foto se describe con visión, el
 * video se transcribe con el mismo Whisper que usa TikTok. Un post con 400
 * comentarios se entiende UNA vez, no 400.
 *
 * Falla blando de punta a punta. Sin clave, sin medio o con Meta negando la
 * descarga, la fila queda en `error` y el resto sigue igual que antes: con el
 * caption y nada más. Nunca se inventa lo que la foto "seguro mostraba".
 */

const GRAPH = "https://graph.facebook.com/v22.0";
/** Techo del archivo. Whisper corta en 25 MB y un reel de un minuto pesa ~5 MB. */
const MAX_BYTES = 24 * 1024 * 1024;
/** Una imagen de Instagram ronda 1 MB; lo que pase de acá no es una foto de post. */
const MAX_IMAGEN_BYTES = 8 * 1024 * 1024;
/** Cuántas veces se reintenta antes de abandonar: la cuota no se quema en el
 *  mismo archivo roto cada diez minutos. */
const MAX_INTENTOS = 4;
/** Y entre intento e intento se espera: cuando Meta niega el medio suele ser
 *  por un rato, no para siempre. */
const ESPERA_ENTRE_INTENTOS_MS = 30 * 60 * 1000;
const TIMEOUT_TRANSCRIPCION_MS = 120_000;
/**
 * Cuánto puede durar la tanda entera.
 *
 * Vive dentro del cron de comentarios, que arranca cada 2 minutos. Una foto se
 * describe en ~1 s, pero un video son la descarga más ~12 s de Whisper: cuatro
 * videos seguidos empujarían la corrida por encima de los 2 minutos y la
 * siguiente arrancaría encima de esta. Se deja de EMPEZAR trabajos nuevos al
 * llegar acá; lo que quede espera a la próxima corrida, que es dentro de dos
 * minutos.
 */
const PRESUPUESTO_MS = 45_000;

/** Lo que se encontró colgado de la publicación. */
interface Medio {
  tipo: "imagen" | "video";
  url: string;
  caption?: string;
}

interface FilaContexto {
  id: string;
  workspace_id: string;
  channel: string;
  external_id: string;
  titulo: string | null;
  medio_tipo: string | null;
  medio_url: string | null;
  medio_entendido: string | null;
  product_ids?: string[] | null;
  product_match_status?: string | null;
  estado: string;
  intentos: number;
}

/**
 * Anota que hay una publicación de la que conviene saber algo. No baja nada:
 * eso lo hace el cron. Se llama en el camino del comentario, que tiene que ser
 * rápido — una respuesta no puede esperar a que se transcriba un reel.
 */
export async function anotarPublicacion(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    channel: string;
    externalId: string;
    titulo?: string | null;
  },
): Promise<void> {
  if (!args.externalId.trim()) return;
  await db
    .from("publicacion_contexto")
    .upsert(
      {
        workspace_id: args.workspaceId,
        channel: args.channel,
        external_id: args.externalId,
        ...(args.titulo ? { titulo: args.titulo.slice(0, 2000) } : {}),
      },
      { onConflict: "workspace_id,channel,external_id", ignoreDuplicates: true },
    )
    .then(
      () => {},
      () => {},
    );
}

/**
 * Lo que se entendió del medio, listo para pegar en el prompt. `null` cuando
 * todavía no se sabe nada — y entonces el prompt queda como estaba.
 */
export async function briefDeMedio(
  db: SupabaseClient,
  args: { workspaceId: string; channel: string; externalId: string },
): Promise<string | null> {
  const contextResult = await db
    .from("publicacion_contexto")
    .select("medio_tipo, medio_entendido, product_ids, product_match_status")
    .eq("workspace_id", args.workspaceId)
    .eq("channel", args.channel)
    .eq("external_id", args.externalId)
    .maybeSingle();
  // Durante un deploy gradual puede llegar código antes que la migración. El
  // análisis del post no debe caerse por eso: vuelve al contexto previo y el
  // vínculo con producto se completa en la siguiente pasada del cron.
  const fallback = contextResult.error
    ? await db.from('publicacion_contexto').select('medio_tipo, medio_entendido')
      .eq("workspace_id", args.workspaceId)
      .eq("channel", args.channel)
      .eq("external_id", args.externalId)
      .maybeSingle()
    : null;
  const data = (contextResult.data ?? fallback?.data) as {
    medio_tipo: string | null;
    medio_entendido: string | null;
    product_ids?: string[] | null;
    product_match_status?: string | null;
  } | null;
  const texto = data?.medio_entendido?.trim();
  const ids = Array.isArray(data?.product_ids) ? data.product_ids.filter(Boolean) : [];
  const { data: products } = ids.length
    ? await db.from('shopify_products').select('id, title').in('id', ids)
    : { data: [] as Array<{ id: string; title: string | null }> };
  const names = (products ?? []).map((product) => String(product.title ?? '').trim()).filter(Boolean);
  const medio = !texto
    ? null
    : data?.medio_tipo === "video"
    ? `Lo que se dice en el video: "${texto.slice(0, 4000)}"`
    : `Lo que se ve en la imagen: ${texto.slice(0, 1200)}`;
  const producto = names.length ? `Producto identificado en esta publicación: ${names.join(', ')}.` : null;
  return [medio, producto].filter(Boolean).join('\n') || null;
}

/**
 * Entiende las publicaciones que faltan. Lo llama el cron de comentarios, con
 * un tope chico por corrida: lo que importa es que el post de hoy —el que está
 * juntando comentarios— se entienda pronto, no vaciar la cola de una sentada.
 */
export async function entenderPendientes(
  db: SupabaseClient,
  opts: { limite?: number } = {},
): Promise<{ intentados: number; entendidos: number }> {
  const limite = Math.max(1, opts.limite ?? 4);
  const desde = new Date(Date.now() - ESPERA_ENTRE_INTENTOS_MS).toISOString();

  const { data } = await db
    .from("publicacion_contexto")
    .select("*")
    .in("estado", ["pendiente", "error"])
    .lt("intentos", MAX_INTENTOS)
    .or(`intentado_at.is.null,intentado_at.lt.${desde}`)
    .order("created_at", { ascending: false })
    .limit(limite);

  const filas = (data ?? []) as FilaContexto[];
  let entendidos = 0;
  const hasta = Date.now() + PRESUPUESTO_MS;
  for (const fila of filas) {
    if (Date.now() > hasta) break;
    try {
      if (await entenderUna(db, fila)) entendidos++;
    } catch (err) {
      console.warn(
        "[publicacion-media] falló:",
        fila.external_id,
        err instanceof Error ? err.message : err,
      );
      await marcar(db, fila, "error");
    }
  }
  return { intentados: filas.length, entendidos };
}

/**
 * Completa el vínculo producto para publicaciones que ya se habían analizado
 * antes de que existiera el mapeo. No vuelve a descargar ni a transcribir el
 * medio: usa únicamente el contexto que ya quedó guardado.
 */
export async function identificarProductosPendientes(
  db: SupabaseClient,
  opts: { limite?: number } = {},
): Promise<{ intentados: number; identificados: number }> {
  const limite = Math.max(1, opts.limite ?? 12);
  const { data } = await db
    .from('publicacion_contexto')
    .select('id, workspace_id, titulo, cuerpo, medio_entendido')
    .eq('estado', 'listo')
    .eq('product_match_status', 'pending')
    .order('updated_at', { ascending: false })
    .limit(limite);
  let identificados = 0;
  for (const post of (data ?? []) as Array<{
    id: string;
    workspace_id: string;
    titulo: string | null;
    cuerpo: string | null;
    medio_entendido: string | null;
  }>) {
    const match = await identificarProductos(
      db,
      post.workspace_id,
      [post.titulo, post.cuerpo, post.medio_entendido].filter(Boolean).join('\n'),
    );
    const { error } = await db.from('publicacion_contexto').update({
      product_ids: match.ids,
      product_match_status: match.status,
      product_matched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', post.id);
    if (!error && match.status === 'identified') identificados++;
  }
  return { intentados: (data ?? []).length, identificados };
}

async function marcar(
  db: SupabaseClient,
  fila: FilaContexto,
  estado: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await db
    .from("publicacion_contexto")
    .update({
      estado,
      intentos: fila.intentos + 1,
      intentado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", fila.id);
}

async function entenderUna(db: SupabaseClient, fila: FilaContexto): Promise<boolean> {
  const conn = await conexionDe(db, fila);
  const token = conn ? tokenDe(conn) : null;
  if (!token) {
    await marcar(db, fila, "error");
    return false;
  }

  const medio = await medioDelPost(fila, token);
  if (medio === "falló") {
    // Graph negó la lectura: se reintenta más tarde.
    await marcar(db, fila, "error");
    return false;
  }
  if (!medio) {
    // La publicación existe y no tiene medio que mirar (un post de sólo
    // texto). No es un fallo y no se reintenta.
    await marcar(db, fila, "sin_medio");
    return false;
  }

  const imagen =
    medio.tipo === "video"
      ? null
      : await queSeVeEnLaImagen(db, fila.workspace_id, medio.url);
  const entendido =
    medio.tipo === "video" ? await queSeDiceEnElVideo(medio.url) : (imagen?.texto ?? null);

  // Entender la publicación se le cobra al comercio: es una llamada al modelo
  // con la clave de Riverz, igual que una respuesta. Se cobra sólo si salió
  // bien — un intento fallido no le dio nada a nadie. El video queda gratis a
  // propósito: lo transcribe Whisper en Groq, que sale una fracción de centavo
  // por hora y cobrarlo costaría más ruido en el libro que la plata que mueve.
  if (entendido && medio.tipo !== "video") {
    void cobrar(db, fila.workspace_id, {
      concepto: "entender_publicacion",
      cantidad: 1,
      // El costo real de esa llamada, no la tarifa: es lo que Anthropic le
      // cobró a Riverz por mirar esa foto.
      costoUsd: imagen?.costoUsd ?? 0,
      referenciaTipo: "publicacion",
      referenciaId: fila.external_id,
      detalle: { medio: medio.tipo },
    });
  }

  if (!entendido) {
    await marcar(db, fila, "error", { medio_tipo: medio.tipo, medio_url: medio.url });
    return false;
  }
  const productMatch = await identificarProductos(db, fila.workspace_id, [
    fila.titulo,
    medio.caption,
    entendido,
  ].filter(Boolean).join('\n'));
  await marcar(db, fila, "listo", {
    medio_tipo: medio.tipo,
    medio_url: medio.url,
    medio_entendido: entendido.slice(0, 6000),
    ...(medio.caption ? { titulo: medio.caption.slice(0, 2000) } : {}),
  });
  // La tabla puede estar en un deploy intermedio sin las columnas nuevas. El
  // análisis principal ya quedó guardado; sólo se salta el enlace derivado y
  // el cron lo recupera cuando el esquema esté actualizado.
  await db.from('publicacion_contexto').update({
    product_ids: productMatch.ids,
    product_match_status: productMatch.status,
    product_matched_at: new Date().toISOString(),
  }).eq('id', fila.id).then(() => {}, () => {});
  return true;
}

interface ProductCandidate {
  id: string;
  title: string;
  handle: string | null;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Identificación conservadora: si hay duda, no enlaza un producto. */
export function matchProductsInPublication(
  products: ProductCandidate[],
  source: string,
): { ids: string[]; status: 'identified' | 'ambiguous' | 'unidentified' } {
  const hay = normalize(source);
  if (!hay) return { ids: [], status: 'unidentified' };
  const scored = products.map((product) => {
    const title = normalize(product.title);
    const handle = normalize(product.handle ?? '');
    if ((title.length >= 4 && hay.includes(title)) || (handle.length >= 4 && hay.includes(handle))) return { id: product.id, score: 100 };
    const words = title.split(' ').filter((word) => word.length >= 4);
    const hits = words.filter((word) => hay.includes(word)).length;
    return { id: product.id, score: words.length > 0 && hits >= 2 ? hits : 0 };
  }).filter((candidate) => candidate.score > 0);
  if (scored.length === 0) return { ids: [], status: 'unidentified' };
  const best = Math.max(...scored.map((candidate) => candidate.score));
  const winners = scored.filter((candidate) => candidate.score === best);
  return winners.length === 1 ? { ids: [winners[0].id], status: 'identified' } : { ids: [], status: 'ambiguous' };
}

async function identificarProductos(
  db: SupabaseClient,
  workspaceId: string,
  source: string,
): Promise<{ ids: string[]; status: 'identified' | 'ambiguous' | 'unidentified' }> {
  const { data } = await db.from('shopify_products').select('id, title, handle').eq('workspace_id', workspaceId).limit(100);
  return matchProductsInPublication((data ?? []) as ProductCandidate[], source);
}

/**
 * La conexión con la que hablarle a Graph de ESTE post.
 *
 * Sale del hilo donde entró el comentario, no de "la conexión más nueva del
 * workspace": una cuenta puede tener dos Instagram conectados y el token del
 * segundo no puede leer los posts del primero. Graph contesta a eso con
 * "Object with ID does not exist, cannot be loaded due to missing
 * permissions", que se lee como un post borrado y no lo es. Medido contra la
 * cuenta viva el 2026-08-28: de tres posts, el que venía de la otra cuenta era
 * el único que fallaba.
 */
async function conexionDe(
  db: SupabaseClient,
  fila: FilaContexto,
): Promise<ChannelConnection | null> {
  const { data: conv } = await db
    .from("conversations")
    .select("connection_id")
    .eq("workspace_id", fila.workspace_id)
    .eq("channel", fila.channel)
    .eq("thread_external_id", fila.external_id)
    .not("connection_id", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const connId = (conv as { connection_id?: string | null } | null)?.connection_id;
  if (connId) {
    const { data } = await db
      .from("channel_connections")
      .select("*")
      .eq("id", connId)
      .maybeSingle();
    const propia = (data as ChannelConnection | null) ?? null;
    if (propia?.secrets) return propia;
  }

  // Sin hilo (o sin secretos en esa fila): la conexión viva del canal.
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("workspace_id", fila.workspace_id)
    .eq("channel", fila.channel)
    .neq("status", "disconnected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ChannelConnection | null) ?? null;
}

function tokenDe(conn: ChannelConnection): string | null {
  const secrets = (conn.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!enc) return null;
  try {
    return decrypt(enc) || null;
  } catch {
    return null;
  }
}

/**
 * El medio de la publicación.
 *
 * Instagram y Facebook llaman distinto a lo mismo, así que se piden todos los
 * campos y se usa el que venga. En un carrusel de Instagram se mira la PRIMERA
 * imagen: es la que se ve sin deslizar y de la que habla casi todo el mundo.
 */
async function medioDelPost(
  fila: FilaContexto,
  token: string,
): Promise<Medio | "falló" | null> {
  // Los campos van por red, NO juntos: Graph RECHAZA el campo que no existe en
  // ese tipo de nodo en vez de ignorarlo, así que pedirle `message` a un Media
  // de Instagram tira la petición entera y el post quedaba marcado como "sin
  // medio" teniendo foto. Medido contra la cuenta viva el 2026-08-28.
  const campos =
    fila.channel === "ig_comment"
      ? "caption,media_type,media_url,thumbnail_url,children{media_type,media_url}"
      : "message,full_picture,attachments{media_type,media{image{src}}}";
  const url = withAppsecretProof(
    `${GRAPH}/${fila.external_id}?fields=${campos}&access_token=${encodeURIComponent(token)}`,
    token,
  );
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  // "Graph dijo que no" y "el post no tiene foto" son cosas distintas: la
  // primera se reintenta, la segunda no. Confundirlas dejaba un post con foto
  // marcado para siempre como si no la tuviera.
  if (!res.ok) {
    console.warn(
      "[publicacion-media] Graph rechazó el post:",
      fila.external_id,
      res.status,
      (await res.text().catch(() => "")).slice(0, 200),
    );
    return "falló";
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  const caption = String(j.caption ?? j.message ?? "").trim() || undefined;
  const tipoCrudo = String(j.media_type ?? "").toUpperCase();

  // Instagram: VIDEO / REELS traen el mp4 en media_url.
  if ((tipoCrudo === "VIDEO" || tipoCrudo === "REELS") && j.media_url) {
    return { tipo: "video", url: String(j.media_url), caption };
  }
  if (tipoCrudo === "IMAGE" && j.media_url) {
    return { tipo: "imagen", url: String(j.media_url), caption };
  }
  // Carrusel: la primera hija.
  const hijos = (j.children as { data?: Array<Record<string, unknown>> } | undefined)?.data;
  const primera = hijos?.[0];
  if (primera?.media_url) {
    const t = String(primera.media_type ?? "").toUpperCase();
    return {
      tipo: t === "VIDEO" ? "video" : "imagen",
      url: String(primera.media_url),
      caption,
    };
  }
  // Facebook: full_picture es la imagen del post ya recortada.
  if (j.full_picture) return { tipo: "imagen", url: String(j.full_picture), caption };
  const adj = (j.attachments as { data?: Array<Record<string, unknown>> } | undefined)?.data?.[0];
  const src = ((adj?.media as { image?: { src?: string } } | undefined)?.image ?? {}).src;
  if (src) return { tipo: "imagen", url: String(src), caption };
  // Graph contestó y no hay medio: es un post de sólo texto.
  return null;
}

/**
 * Qué se ve en la foto.
 *
 * Se le pide lo que sirve para CONTESTAR un comentario —qué producto se ve,
 * cuántos, qué dice el texto sobreimpreso— y nada de lo que no: describir a
 * las personas de la foto no ayuda a contestar y sí crea un registro que nadie
 * pidió.
 */
async function queSeVeEnLaImagen(
  db: SupabaseClient,
  workspaceId: string,
  url: string,
): Promise<{ texto: string; costoUsd: number } | null> {
  const resuelta = await resolveAnthropicKey(db, { workspaceId });
  if (!resuelta) return null;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGEN_BYTES) return null;

  try {
    const salida = await describeImage({
      base64: buf.toString("base64"),
      mediaType: toImageMediaType(res.headers.get("content-type")),
      system:
        "Describes la imagen de una publicación de una tienda para que otro asistente " +
        "pueda contestar los comentarios que la gente deja debajo. Español neutro.",
      user:
        "¿Qué se ve? En dos o tres frases: qué producto o productos aparecen, cuántos y " +
        "cómo se distinguen entre sí (color, tamaño, posición), y qué dice el texto " +
        "sobreimpreso si lo hay. No describas a las personas ni su aspecto. No inventes " +
        "precios, ingredientes ni promociones: si no está escrito en la imagen, no lo pongas.",
      maxTokens: 300,
      anthropicKey: resuelta.key,
    });
    const limpio = limpiar(salida.text);
    if (!limpio) return null;
    // Lo que costó DE VERDAD, para pasárselo tal cual al comercio.
    return {
      texto: limpio,
      costoUsd:
        resuelta.source === 'agent'
          ? 0
          : costForModel(salida.modelo, salida.uso.prompt, salida.uso.salida, {
              read: salida.uso.cacheLeida,
              write: salida.uso.cacheEscrita,
            }),
    };
  } catch {
    return null;
  }
}

/**
 * El modelo a veces encabeza con "# Descripción de la imagen". Eso viaja
 * después DENTRO de otro prompt, donde un título suelto no describe nada y
 * sólo ocupa lugar.
 */
function limpiar(texto: string): string | null {
  const sinTitulo = texto
    .trim()
    .replace(/^#{1,6}\s[^\n]*\n*/, "")
    .trim();
  return sinTitulo || null;
}

/** Qué se dice en el video. Mismo Whisper que usa TikTok. */
async function queSeDiceEnElVideo(url: string): Promise<string | null> {
  if (!transcripcionDisponible()) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

  const out = await transcribeBuffer(buf, {
    mime: res.headers.get("content-type") || "video/mp4",
    filename: "post.mp4",
    timeoutMs: TIMEOUT_TRANSCRIPCION_MS,
  });
  const texto = out?.text?.trim();
  return texto || null;
}
