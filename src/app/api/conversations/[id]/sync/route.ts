import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { decrypt } from "@/lib/channels/encryption";
import {
  resolveThreadId,
  syncThreadMessages,
  type MetaPlatform,
} from "@/lib/channels/meta-dm-history";
import type { ChannelConnection } from "@/types";

/** Cada cuánto vale la pena volver a preguntarle a Meta por el mismo hilo. */
const RESYNC_MS = 10 * 60_000;
/** Cuánta historia traer: 4 páginas de 50 = hasta 200 mensajes, sin ventana. */
const MAX_PAGES = 4;

/**
 * POST /api/conversations/:id/sync
 *
 * Rellena la conversación con lo que falte del historial de Meta (Messenger /
 * Instagram) al abrirla en la bandeja: mensajes del cliente que no llegaron por
 * webhook y respuestas que el equipo mandó desde la app de Meta. Sin esto, un
 * hilo sólo se completaba en la corrida diaria del cron.
 *
 * Nunca crea conversaciones (createIfMissing:false) y es idempotente — el
 * índice único por `message_id` descarta lo ya guardado.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.missingIdGeneric") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );
  }

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, workspace_id, channel, contact_id, connection_id, synced_at")
    .eq("id", id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  }
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conv.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  // Sólo los canales que tienen historial consultable en Graph.
  if (conv.channel !== "messenger" && conv.channel !== "instagram") {
    return NextResponse.json({ ok: true, ingested: 0, skipped: "channel" });
  }
  // Abrir y cerrar el mismo chat no dispara una ronda de llamadas a Meta.
  const lastSync = conv.synced_at ? Date.parse(conv.synced_at) : NaN;
  if (Number.isFinite(lastSync) && Date.now() - lastSync < RESYNC_MS) {
    return NextResponse.json({ ok: true, ingested: 0, skipped: "throttled" });
  }

  try {
    const { data: contact } = await admin
      .from("contacts")
      .select("external_id, name")
      .eq("id", conv.contact_id)
      .maybeSingle();
    const externalId = contact?.external_id ? String(contact.external_id) : "";
    if (!externalId) return NextResponse.json({ ok: true, ingested: 0 });

    // La conexión propia de la conversación; si quedó sin sellar, la del canal.
    let connection: ChannelConnection | null = null;
    if (conv.connection_id) {
      const { data } = await admin
        .from("channel_connections")
        .select("*")
        .eq("id", conv.connection_id)
        .maybeSingle();
      connection = (data as ChannelConnection) ?? null;
    }
    if (!connection) {
      const { data } = await admin
        .from("channel_connections")
        .select("*")
        .eq("workspace_id", conv.workspace_id)
        .eq("channel", conv.channel)
        .eq("status", "connected")
        .limit(1)
        .maybeSingle();
      connection = (data as ChannelConnection) ?? null;
    }
    if (!connection) return NextResponse.json({ ok: true, ingested: 0 });

    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
    const enc = String(secrets.access_token ?? "");
    const pageId = String(cfg.page_id ?? "");
    const isMessenger = connection.channel === "messenger";
    const selfId = isMessenger ? pageId : String(cfg.ig_user_id ?? "");
    if (!enc || !pageId || !selfId) {
      return NextResponse.json({ ok: true, ingested: 0 });
    }
    const token = decrypt(enc);
    const platform: MetaPlatform = isMessenger ? "messenger" : "instagram";

    // Marcamos el intento ANTES de salir a la red: si Meta tarda o falla, dos
    // aperturas seguidas no disparan dos tandas de llamadas.
    await admin
      .from("conversations")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", conv.id);

    const threadId = await resolveThreadId(token, pageId, platform, externalId);
    if (!threadId) return NextResponse.json({ ok: true, ingested: 0 });

    const ingested = await syncThreadMessages({
      token,
      selfId,
      connection,
      threadId,
      externalId,
      contactName: contact?.name ?? undefined,
      createIfMissing: false,
      maxPages: MAX_PAGES,
    });
    return NextResponse.json({ ok: true, ingested });
  } catch (err) {
    return serverError(err);
  }
}
