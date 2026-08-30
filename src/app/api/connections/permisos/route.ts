import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { ChannelConnection, Conversation } from "@/types";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * GET /api/connections/permisos?id=<connection_id>
 *
 * QUÉ PERMISOS TIENE DE VERDAD ESTA CONEXIÓN.
 *
 * Existe porque Meta no lo dice cuando importa. Al rechazar una acción por
 * falta de permiso, Graph contesta `#1 An unknown error occurred` —su código
 * más inútil— y el comercio se queda con "ocurrió un error desconocido" sobre
 * algo que se arregla en dos minutos si uno sabe QUÉ falta. Medido el
 * 2026-08-30: ocultar un comentario de Facebook fallaba con #1 mientras quitar
 * un me-gusta funcionaba, y separar esas dos cosas llevó media hora de pruebas
 * a mano.
 *
 * `debug_token` sí lo dice. Devuelve los permisos concedidos y, cruzándolos
 * contra lo que ese canal necesita, cuáles faltan y con nombre propio.
 *
 * Sólo lectura y sólo para admins del espacio: un token es una credencial y
 * saber qué puede hacer es información del negocio, no pública.
 */

/** Lo que cada canal necesita de verdad para trabajar. */
const NECESITA: Record<string, string[]> = {
  // Ocultar y responder comentarios de una página pide LAS DOS. Es el par que
  // Graph nunca nombra al fallar.
  fb_comment: ["pages_manage_engagement", "pages_read_user_content", "pages_read_engagement"],
  messenger: ["pages_messaging", "pages_show_list"],
  ig_comment: ["instagram_manage_comments", "instagram_basic"],
  instagram: ["instagram_manage_messages", "instagram_basic"],
  whatsapp: ["whatsapp_business_messaging", "whatsapp_business_management"],
};

/**
 * ¿ESTA PÁGINA nos manda lo que pasa en ella?
 *
 * Son dos suscripciones distintas y hay que tener las DOS: la de la app —qué
 * campos quiere recibir— y la de la página, que es la que de verdad empuja los
 * eventos. La segunda se pierde sola: desconectar y volver a conectar la
 * rehace, pero entre medio la página deja de mandar y no avisa nadie. Es el
 * modo de falla más caro que tiene esto, porque "no llegan los comentarios" se
 * ve igual que "no comentó nadie".
 *
 * Devuelve los campos que la página tiene suscritos para NUESTRA app, o `null`
 * si no se pudo preguntar (no aplica a canales que no son de página).
 */
async function queRecibe(
  conn: ChannelConnection,
  token: string,
): Promise<{ campos: string[]; suscrita: boolean } | null> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const pageId = String(cfg.page_id ?? "");
  if (!pageId) return null;
  try {
    const r = await fetch(
      `${GRAPH}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      data?: Array<{ id?: string; subscribed_fields?: string[] }>;
    };
    const mia = (j.data ?? []).find((a) => a.id === process.env.META_APP_ID);
    return {
      suscrita: Boolean(mia),
      campos: mia?.subscribed_fields ?? [],
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );
  }

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "falta id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("channel_connections")
    .select("id, workspace_id, channel, secrets, config")
    .eq("id", id)
    .maybeSingle();
  const conn = row as ChannelConnection | null;
  if (!conn) {
    return NextResponse.json({ error: "no existe" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", (conn as unknown as Conversation).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role !== "admin") {
    return NextResponse.json(
      { error: translate(locale, "errInbox.adminOnly") },
      { status: 403 },
    );
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "la app de Meta no está configurada en el servidor" },
      { status: 503 },
    );
  }

  const enc = String((conn.secrets as Record<string, unknown> | null)?.access_token ?? "");
  if (!enc) {
    return NextResponse.json({ error: "la conexión no tiene token" }, { status: 409 });
  }

  try {
    const token = decrypt(enc);
    const url =
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as {
      data?: { scopes?: string[]; expires_at?: number; is_valid?: boolean };
      error?: { message?: string };
    };
    if (!r.ok || j.error) {
      return NextResponse.json(
        { error: j.error?.message ?? `HTTP ${r.status}` },
        { status: 502 },
      );
    }
    const tiene = j.data?.scopes ?? [];
    const faltan = (NECESITA[conn.channel] ?? []).filter((p) => !tiene.includes(p));
    return NextResponse.json({
      canal: conn.channel,
      valido: j.data?.is_valid ?? null,
      // 0 = permanente, que es lo normal en un token de página.
      vence: j.data?.expires_at ?? null,
      tiene,
      necesita: NECESITA[conn.channel] ?? [],
      faltan,
      recibe: await queRecibe(conn, token),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "no se pudo consultar" },
      { status: 500 },
    );
  }
}
