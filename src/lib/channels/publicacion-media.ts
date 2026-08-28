import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { describeImage, toImageMediaType } from "@/lib/ai/llm-client";
import { resolveAnthropicKey } from "@/lib/ai/platform-key";
import { transcribeBuffer, transcripcionDisponible } from "@/lib/ai/transcribe";

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
  const { data } = await db
    .from("publicacion_contexto")
    .select("medio_tipo, medio_entendido")
    .eq("workspace_id", args.workspaceId)
    .eq("channel", args.channel)
    .eq("external_id", args.externalId)
    .maybeSingle();
  const f = data as { medio_tipo: string | null; medio_entendido: string | null } | null;
  const texto = f?.medio_entendido?.trim();
  if (!texto) return null;
  return f?.medio_tipo === "video"
    ? `Lo que se dice en el video: "${texto.slice(0, 4000)}"`
    : `Lo que se ve en la imagen: ${texto.slice(0, 1200)}`;
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
  for (const fila of filas) {
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

  const entendido =
    medio.tipo === "video"
      ? await queSeDiceEnElVideo(medio.url)
      : await queSeVeEnLaImagen(db, fila.workspace_id, medio.url);

  if (!entendido) {
    await marcar(db, fila, "error", { medio_tipo: medio.tipo, medio_url: medio.url });
    return false;
  }
  await marcar(db, fila, "listo", {
    medio_tipo: medio.tipo,
    medio_url: medio.url,
    medio_entendido: entendido.slice(0, 6000),
    ...(medio.caption ? { titulo: medio.caption.slice(0, 2000) } : {}),
  });
  return true;
}

/** La conexión del canal, para hablar con Graph con su token. */
async function conexionDe(
  db: SupabaseClient,
  fila: FilaContexto,
): Promise<ChannelConnection | null> {
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
): Promise<string | null> {
  const resuelta = await resolveAnthropicKey(db, { workspaceId });
  if (!resuelta) return null;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGEN_BYTES) return null;

  try {
    const texto = await describeImage({
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
    return texto.trim() || null;
  } catch {
    return null;
  }
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
