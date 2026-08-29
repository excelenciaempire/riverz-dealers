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
 * Contactos por conexión y por corrida.
 *
 * El barrido era completo: TODOS los contactos de TODAS las conexiones, dos
 * llamadas a Graph cada uno, sin tope. Medido en ~22 min con una sola cuenta;
 * con varias cuentas eso sólo crece, y el reloj corta el `fetch` a los 30 min
 * (`scheduler.ts`) — cuando eso pasa, `withCronRun` nunca llega a escribir la
 * fila y el trabajo desaparece sin dejar ni un error. Fue exactamente lo que
 * pasó: última corrida registrada el 2026-08-26, tres días mudo.
 *
 * Con un lote fijo, el costo de una corrida no depende de cuántos comercios
 * haya: cada conexión avanza su tramo y la siguiente corrida sigue donde
 * quedó.
 */
const LOTE_CONTACTOS = 150;

/**
 * Techo de reloj de la corrida entera. Por debajo del timeout del reloj, para
 * terminar siempre por decisión propia y dejar la fila escrita en `cron_runs`.
 */
const PRESUPUESTO_MS = 8 * 60_000;

/** Dónde quedó el barrido de esta conexión, dentro de `config`. */
const CURSOR = "dm_backfill_cursor";

/**
 * GET /api/cron/meta-dm-backfill
 *
 * Recorre los contactos de Messenger e Instagram, pide el historial del hilo a
 * la Graph API y re-ingiere lo que falte EN AMBOS SENTIDOS: las respuestas que
 * el equipo mandó desde la app de Meta y los mensajes del cliente que nunca
 * llegaron por webhook (caída, permiso faltante, o previos a la conexión).
 * Idempotente: el índice único por `message_id` vuelve no-op lo ya guardado.
 *
 * REANUDABLE: cada conexión procesa `LOTE_CONTACTOS` por corrida y guarda en
 * `config.dm_backfill_cursor` el último contacto visto. Al terminar la vuelta
 * el cursor se borra y el ciclo vuelve a empezar. Así una corrida cortada no
 * pierde el trabajo hecho y el tiempo de cada corrida no crece con la cantidad
 * de comercios conectados.
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
    /** Contactos mirados en ESTA corrida. */
    revisados?: number;
    /** La conexión completó una vuelta entera y el cursor volvió al principio. */
    vuelta_completa?: boolean;
    error?: string;
  }> = [];

  const limite = Date.now() + PRESUPUESTO_MS;
  let sinTiempo = false;

  for (const c of connections as ChannelConnection[]) {
    if (Date.now() > limite) {
      sinTiempo = true;
      break;
    }
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

    // El tramo que le toca a esta conexión. Orden por `id` —estable y con
    // índice— para que el cursor signifique siempre lo mismo aunque entren
    // contactos nuevos en el medio.
    const desde = typeof cfg[CURSOR] === "string" ? (cfg[CURSOR] as string) : null;
    let q = admin
      .from("contacts")
      .select("*")
      .eq("workspace_id", c.workspace_id)
      .eq("channel", c.channel)
      .order("id", { ascending: true })
      .limit(LOTE_CONTACTOS);
    if (desde) q = q.gt("id", desde);
    const { data: contacts } = await q;
    const lote = (contacts ?? []) as Contact[];
    // Vino menos de un lote: no queda nadie después de éstos, la vuelta
    // terminó y la próxima corrida arranca de cero.
    const vueltaCompleta = lote.length < LOTE_CONTACTOS;

    let ingested = 0;
    let revisados = 0;
    // El cursor sólo puede avanzar hasta lo que REALMENTE se miró: si la
    // corrida se corta por tiempo a mitad del lote, guardar el último del lote
    // saltearía a los que quedaron sin revisar.
    let ultimoVisto: string | null = null;
    for (const contact of lote) {
      if (Date.now() > limite) {
        sinTiempo = true;
        break;
      }
      revisados++;
      ultimoVisto = contact.id;
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
    //
    // Va al cerrar la vuelta y no en cada corrida: es una lista de
    // conversaciones de la página entera, así que repetirla en cada tramo del
    // barrido gasta cuota de Graph sin traer nada nuevo.
    const cerroVuelta = vueltaCompleta && !sinTiempo;
    if (cerroVuelta) {
      try {
        ingested += await discoverNewThreads({ token, pageId, selfId, platform, connection: c });
      } catch (err) {
        console.warn(
          `[meta-dm-backfill] ${c.channel} discover new threads failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Guardar dónde quedó. Al cerrar la vuelta el cursor se borra y el ciclo
    // vuelve a empezar por el principio.
    const nuevoCursor = cerroVuelta ? null : (ultimoVisto ?? desde);
    if (nuevoCursor !== desde) {
      await admin
        .from("channel_connections")
        .update({ config: { ...cfg, [CURSOR]: nuevoCursor } })
        .eq("id", c.id);
    }

    results.push({
      connection_id: c.id,
      channel: c.channel,
      ingested,
      revisados,
      vuelta_completa: cerroVuelta,
    });
    if (sinTiempo) break;
  }

  // 207 y no 200 cuando la corrida no llegó a mirarlo todo: `withCronRun` lo
  // registra como fallo parcial y el panel lo dice, en vez de mostrar verde un
  // barrido que se quedó a mitad de camino.
  return NextResponse.json(
    { ok: !sinTiempo, truncado: sinTiempo, results },
    { status: sinTiempo ? 207 : 200 },
  );
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
