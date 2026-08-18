import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { refreshTikTokVideo } from "@/lib/channels/tiktok_comment/poll";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { ChannelConnection, Conversation } from "@/types";

/**
 * POST /api/conversations/:id/tiktok-refresh
 *
 * Trae AHORA los comentarios del video de este hilo, en vez de esperar al cron.
 * TikTok no empuja nada al instante (su propio webhook `comment.update` se
 * dispara "dentro de 5 min"), así que el hilo que el usuario está mirando se
 * refresca solo contra la API mientras esté abierto: lo nuevo entra por
 * realtime y aparece sin recargar.
 *
 * La ingesta es idempotente por comment_id, así que llamarlo de más no duplica.
 * Best-effort: cualquier fallo devuelve `{ ingested: 0 }` — el cron lo levanta.
 */

/** Ventana mínima entre refrescos del MISMO video: varias pestañas mirando el
 *  mismo hilo no deben multiplicar las llamadas a TikTok. */
const MIN_INTERVAL_MS = 8_000;
const lastRun = new Map<string, number>();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const { id } = await ctx.params;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!conv)
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  const conversation = conv as Conversation;

  // Membership guard.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conversation.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );

  if (conversation.channel !== "tiktok_comment") {
    return NextResponse.json({ ingested: 0 });
  }

  // El hilo guarda "video:<id>|comment:<top>".
  const thread = String(conversation.thread_external_id ?? "");
  const videoId = thread.startsWith("video:") ? thread.slice(6).split("|")[0] : "";
  if (!videoId || !conversation.connection_id) {
    return NextResponse.json({ ingested: 0 });
  }

  const key = `${conversation.connection_id}:${videoId}`;
  const now = Date.now();
  const previous = lastRun.get(key) ?? 0;
  if (now - previous < MIN_INTERVAL_MS) {
    return NextResponse.json({ ingested: 0, throttled: true });
  }
  lastRun.set(key, now);
  // El mapa vive en memoria del proceso: podarlo evita que una cuenta con
  // muchos videos lo haga crecer sin techo.
  if (lastRun.size > 500) {
    for (const [k, t] of lastRun) {
      if (now - t > 5 * MIN_INTERVAL_MS) lastRun.delete(k);
    }
  }

  const { data: connection } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", conversation.connection_id)
    .maybeSingle();
  if (!connection) return NextResponse.json({ ingested: 0 });

  try {
    const ingested = await refreshTikTokVideo(connection as ChannelConnection, videoId);
    return NextResponse.json({ ingested });
  } catch (err) {
    console.error("[tiktok-refresh] failed:", err);
    return NextResponse.json({ ingested: 0 });
  }
}
