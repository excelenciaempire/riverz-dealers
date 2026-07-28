import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import {
  resolveThreadId,
  syncThreadMessages,
  type MetaPlatform,
} from "@/lib/channels/meta-dm-history";
import type { ChannelConnection, Contact } from "@/types";
import { withCronRun } from "@/lib/cron/heartbeat";

const GRAPH = "https://graph.facebook.com/v22.0";

// Ventana de relleno. Meta devuelve del más nuevo al más viejo, así que
// dejamos de paginar un hilo al cruzarla. Re-traer meses de historia en cada
// corrida sólo re-confirma lo que ya tenemos; el valor está en cerrar los
// huecos recientes (respuestas desde el celular, webhooks perdidos). El hilo
// que el usuario abre en la bandeja se sincroniza entero aparte
// (/api/conversations/:id/sync).
const BACKFILL_WINDOW_DAYS = 30;

/**
 * GET /api/cron/meta-dm-backfill
 *
 * Recorre cada contacto de Messenger e Instagram, pide el historial del hilo a
 * la Graph API y re-ingiere lo que falte EN AMBOS SENTIDOS: las respuestas que
 * el equipo mandó desde la app de Meta y los mensajes del cliente que nunca
 * llegaron por webhook (caída, permiso faltante, o previos a la conexión).
 * Idempotente: el índice único por `message_id` vuelve no-op lo ya guardado.
 *
 * Auth: `x-cron-secret` matches AUTOMATION_CRON_SECRET.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const { data: connections } = await admin
    .from("channel_connections")
    .select("*")
    .in("channel", ["messenger", "instagram"])
    .eq("status", "connected");
  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const results: Array<{
    connection_id: string;
    channel: string;
    ingested: number;
    error?: string;
  }> = [];

  for (const c of connections as ChannelConnection[]) {
    const cfg = (c.config ?? {}) as Record<string, unknown>;
    const secrets = (c.secrets ?? {}) as Record<string, unknown>;
    const enc = String(secrets.access_token ?? "");
    if (!enc) {
      results.push({ connection_id: c.id, channel: c.channel, ingested: 0, error: "no token" });
      continue;
    }
    const token = decrypt(enc);

    const isMessenger = c.channel === "messenger";
    // Graph lists conversations off the PAGE for both Messenger and
    // Instagram (the latter via platform=instagram). The "self" id for
    // detecting outbound messages differs though: messenger uses the
    // page id, IG uses the IG user id.
    const pageId = String(cfg.page_id ?? "");
    const selfId = isMessenger ? pageId : String(cfg.ig_user_id ?? "");
    const platform: MetaPlatform = isMessenger ? "messenger" : "instagram";
    if (!pageId || !selfId) {
      results.push({ connection_id: c.id, channel: c.channel, ingested: 0, error: "missing ids" });
      continue;
    }

    const { data: contacts } = await admin
      .from("contacts")
      .select("*")
      .eq("workspace_id", c.workspace_id)
      .eq("channel", c.channel);

    let ingested = 0;
    for (const contact of (contacts ?? []) as Contact[]) {
      try {
        const externalId = contact.external_id;
        if (!externalId) continue;
        const threadId = await resolveThreadId(token, pageId, platform, externalId);
        if (!threadId) continue;
        // createIfMissing:false — un mensaje viejo nunca abre una fila nueva en
        // la bandeja ni revive una conversación borrada.
        ingested += await syncThreadMessages({
          token,
          selfId,
          connection: c,
          threadId,
          externalId,
          contactName: contact.name ?? undefined,
          createIfMissing: false,
          windowDays: BACKFILL_WINDOW_DAYS,
        });
      } catch (err) {
        console.warn(
          `[meta-dm-backfill] ${c.channel} contact ${contact.external_id} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Descubrir hilos que el COMERCIO inició desde la app (a alguien que nunca
    // escribió), invisibles para el loop de contactos porque aún no existen en
    // Riverz. Solo se crean si el participante NO tiene contacto todavía, así
    // no revive conversaciones borradas (esas conservan su contacto).
    try {
      ingested += await discoverNewThreads({ token, pageId, selfId, platform, connection: c });
    } catch (err) {
      console.warn(
        `[meta-dm-backfill] ${c.channel} discover new threads failed:`,
        err instanceof Error ? err.message : err,
      );
    }

    results.push({ connection_id: c.id, channel: c.channel, ingested });
  }

  return NextResponse.json({ ok: true, results });
}

interface DiscoverArgs {
  token: string;
  pageId: string;
  selfId: string;
  platform: MetaPlatform;
  connection: ChannelConnection;
}

/**
 * Discover threads the MERCHANT started from the native app to someone who
 * never messaged us (so there's no Riverz contact yet, and the per-contact
 * loop never sees them). Lists the page's conversations, and for each thread
 * whose customer participant has NO contact, backfills the thread with
 * createIfMissing:true. Guard: skipping participants that already have a
 * contact means a soft-deleted conversation (which keeps its contact) is never
 * resurrected.
 */
async function discoverNewThreads(args: DiscoverArgs): Promise<number> {
  const admin = supabaseAdmin();
  // Lista de supresión (GDPR / borrados deliberados): un participante borrado
  // sufre hard-delete (cascadea contacto+conversación+mensajes), así que sin
  // esto el descubrimiento lo re-crearía cada 6 h. La tabla es pequeña; la
  // traemos una vez por canal y filtramos en memoria.
  const { data: tombs } = await admin
    .from("deleted_meta_participants")
    .select("external_id")
    .eq("channel", args.connection.channel);
  const suppressed = new Set((tombs ?? []).map((t) => String(t.external_id)));
  let url: string | null = `${GRAPH}/${args.pageId}/conversations?platform=${args.platform}&fields=id,participants&limit=50&access_token=${encodeURIComponent(args.token)}`;
  let pages = 0;
  let ingested = 0;
  while (url && pages < 3) {
    const r: Response = await fetch(withAppsecretProof(url, args.token));
    if (!r.ok) break;
    const j = (await r.json()) as {
      data?: {
        id?: string;
        participants?: { data?: { id?: string }[] };
      }[];
      paging?: { next?: string };
    };
    for (const conv of j.data ?? []) {
      if (!conv.id) continue;
      // The participant that isn't us is the customer.
      const other = (conv.participants?.data ?? [])
        .map((p) => String(p.id ?? ""))
        .find((id) => id && id !== args.selfId && id !== args.pageId);
      if (!other) continue;
      // Nunca re-descubrir a alguien borrado (GDPR / borrado deliberado).
      if (suppressed.has(other)) continue;
      // Already known → the per-contact loop handles it (and respects any
      // soft-delete). Only genuinely-new participants are discovered here.
      const { data: existing } = await admin
        .from("contacts")
        .select("id")
        .eq("workspace_id", args.connection.workspace_id)
        .eq("channel", args.connection.channel)
        .eq("external_id", other)
        .maybeSingle();
      if (existing) continue;
      ingested += await syncThreadMessages({
        token: args.token,
        selfId: args.selfId,
        connection: args.connection,
        threadId: conv.id,
        externalId: other,
        createIfMissing: true,
        windowDays: BACKFILL_WINDOW_DAYS,
      });
    }
    url = j.paging?.next ?? null;
    pages++;
  }
  return ingested;
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("meta-dm-backfill", cronHandler);
