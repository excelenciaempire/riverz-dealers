import { NextResponse } from "next/server";
import { listConnections } from "@/lib/channels/connections";
import { savePollState } from "@/lib/channels/poll-state";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { selectAll } from "@/lib/db/paginate";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { fetchMetaGraph } from "@/lib/channels/meta-fetch";
import { handleMetaGraphError, parseMetaErrorBody } from "@/lib/channels/meta-auth";
import { syncThreadMessages, type MetaPlatform } from "@/lib/channels/meta-dm-history";
import {
  isInsideMetaDmResumeWindow,
  META_DM_BACKFILL_MARK,
  META_DM_BACKFILL_PENDING,
  readMetaDmBackfillPending,
  syncFullThread,
  updateMetaDmBackfillCheckpoint,
} from "@/lib/channels/meta-dm-backfill-state";
import type { ChannelConnection } from "@/types";
import { withCronRun } from "@/lib/cron/heartbeat";

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * Solape sobre la marca de agua. Meta puede tardar en reflejar un mensaje en
 * `updated_time`, y una corrida puede empezar mientras entra uno: se vuelve a
 * mirar esta franja para no dejar un hueco en la costura. Es barato —
 * re-mirar un hilo cuyos mensajes ya están guardados no inserta nada.
 */
const SOLAPE_MS = 15 * 60_000;

/** Qué hilos mira la PRIMERA corrida de una conexión (no hay marca): los que
 *  tuvieron actividad en estos días. Cada uno entra completo. */
const ARRANQUE_DIAS = 30;

/** Páginas de la lista de conversaciones (50 hilos cada una) por corrida. */
const MAX_PAGINAS_LISTA = 20;

/**
 * Techo de reloj de la corrida entera. Por debajo del timeout del reloj, para
 * terminar siempre por decisión propia y dejar la fila escrita en `cron_runs`.
 */
const PRESUPUESTO_MS = 3 * 60_000;

interface ConversacionGraph {
  id?: string;
  updated_time?: string;
  participants?: { data?: Array<{ id?: string; name?: string; username?: string }> };
}

/**
 * GET /api/cron/meta-dm-backfill
 *
 * Red de seguridad de los DM de Messenger e Instagram. Lo normal entra por
 * webhook —los mensajes del cliente y los ecos de lo que el comercio responde
 * desde la app de Meta—; esto sólo cierra lo que el webhook no entregó (una
 * caída, un permiso que faltaba, un host viejo).
 *
 * INCREMENTAL: le pregunta a Meta QUÉ CAMBIÓ desde la última pasada, en vez de
 * recorrer todos los contactos. Lista `/{page}/conversations` —que viene
 * ordenada por `updated_time` descendente— y corta en la marca de agua. En
 * régimen eso es UNA llamada y cero hilos que sincronizar.
 *
 * El diseño anterior recorría los ~475 contactos de a lotes de 150, con dos
 * llamadas a Graph por contacto, releyendo los mismos 30 días cada dos horas.
 * Nunca cerraba una vuelta: agotaba el presupuesto de 8 minutos SIEMPRE,
 * devolvía 207, y `withCronRun` lo anotaba como `error` — de ahí el aviso
 * "Trabajo detenido: meta-dm-backfill" en un trabajo que corría puntual cada
 * dos horas. La alarma era real como síntoma y falsa como diagnóstico.
 *
 * REANUDABLE: si una pasada no llega a cruzar la marca (sólo pasa en el
 * arranque, con 30 días de historia), guarda en `config` dónde quedó y la
 * corrida siguiente sigue hacia atrás desde ahí. La marca sólo avanza cuando
 * la pasada se cierra entera, así nunca se saltea un tramo sin mirar.
 *
 * Hilos que el comercio inició desde la app hacia alguien que nunca escribió:
 * salen de la misma lista. El participante sin contacto en Riverz se crea
 * (`createIfMissing`), salvo que esté en la lista de supresión de borrados.
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
  const connections = await listConnections(admin, {
    channels: ["messenger", "instagram"],
  });
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }
  connections.sort((a, b) => String(a.config?.dm_backfill_attempt_at ?? '').localeCompare(String(b.config?.dm_backfill_attempt_at ?? '')));

  const results: Array<{
    connection_id: string;
    channel: string;
    /** Mensajes que ENTRARON de verdad (los repetidos no cuentan). */
    ingested: number;
    /** Hilos con actividad nueva que se sincronizaron en esta corrida. */
    hilos?: number;
    /** La pasada llegó hasta la marca: no queda nada atrás por mirar. */
    al_dia?: boolean;
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
    let token: string;
    try { token = decrypt(enc); } catch {
      results.push({ connection_id: c.id, channel: c.channel, ingested: 0, error: 'invalid token' });
      continue;
    }

    const isMessenger = c.channel === "messenger";
    // Graph lista las conversaciones de la PÁGINA en los dos canales (el de
    // Instagram vía platform=instagram). Lo que cambia es el "yo" con el que
    // se detecta lo saliente: la página en Messenger, el usuario IG en
    // Instagram.
    const pageId = String(cfg.page_id ?? "");
    const selfId = isMessenger ? pageId : String(cfg.ig_user_id ?? "");
    const platform: MetaPlatform = isMessenger ? "messenger" : "instagram";
    if (!pageId || !selfId) {
      results.push({ connection_id: c.id, channel: c.channel, ingested: 0, error: "missing ids" });
      continue;
    }

    const arranque = new Date().toISOString();
    const connectionDeadline = Math.min(limite, Date.now() + 45_000);
    await savePollState(admin, c.id, { dm_backfill_attempt_at: arranque }, null, { complete: false });
    const pend = readMetaDmBackfillPending(cfg[META_DM_BACKFILL_PENDING]);
    const objetivo = pend?.objetivo ?? arranque;
    const marca =
      typeof cfg[META_DM_BACKFILL_MARK] === "string"
        ? (cfg[META_DM_BACKFILL_MARK] as string)
        : null;
    const pisoMs =
      (marca ? new Date(marca).getTime() : Date.now() - ARRANQUE_DIAS * 86_400_000) - SOLAPE_MS;
    const pisoIso = new Date(pisoMs).toISOString();
    // Techo: en una pasada reanudada, los hilos más nuevos que esto ya se
    // miraron en la corrida anterior. `>` y no `>=` para que el hilo del borde
    // se vuelva a mirar (es idempotente) en vez de saltearse si dos hilos
    // comparten `updated_time`.
    const suprimidos = await listaDeSupresion(c.channel);

    let ingested = 0;
    let hilos = 0;
    let ultimoMirado: string | null = null;
    let alDia = false;
    let paginas = 0;
    let fallo: string | null = null;
    let listAfter = String(cfg.dm_backfill_list_after ?? '');
    let url: string | null =
      `${GRAPH}/${pageId}/conversations?platform=${platform}` +
      `&fields=id,updated_time,participants&limit=50` +
      `&access_token=${encodeURIComponent(token)}`;
    if (listAfter) url += `&after=${encodeURIComponent(listAfter)}`;

    try {
      while (url && paginas < MAX_PAGINAS_LISTA) {
        if (Date.now() > connectionDeadline) {
          break;
        }
        // `paging.next` no lleva el proof — se re-adjunta en cada página.
        const r = await fetchMetaGraph(withAppsecretProof(url, token), {}, { deadlineMs: connectionDeadline });
        if (!r.ok) {
          // Un token revocado o sin los permisos de Página necesarios no se
          // recupera reintentando cada dos horas. Marcar sólo esa conexión la
          // saca de este barrido y muestra la acción de reconectar; el resto
          // de comercios sigue sincronizando y el cron no queda en rojo para
          // siempre por una sola cuenta.
          const body = await r.text().catch(() => "");
          await handleMetaGraphError(admin, c, r.status, parseMetaErrorBody(body));
          fallo = `graph ${r.status}`;
          break;
        }
        const j = (await r.json()) as {
          data?: ConversacionGraph[];
          paging?: { next?: string };
        };
        const lote = j.data ?? [];
        // Meta devolvió una página vacía: no hay más historia que mirar.
        if (lote.length === 0) {
          alDia = true;
          break;
        }

        for (const conv of lote) {
          if (Date.now() > connectionDeadline) {
            break;
          }
          const cuando = conv.updated_time ? new Date(conv.updated_time).getTime() : NaN;
          if (!conv.id || !Number.isFinite(cuando)) continue;
          // La lista viene del más nuevo al más viejo: cruzar el piso significa
          // que todo lo que sigue ya está guardado.
          if (cuando < pisoMs) {
            alDia = true;
            break;
          }
          // Pasada reanudada: este tramo ya se miró en la corrida anterior.
          if (!isInsideMetaDmResumeWindow(cuando, pend) && cfg.dm_backfill_thread_id !== conv.id) continue;

          ultimoMirado = conv.updated_time ?? ultimoMirado;

          // El participante que no somos nosotros es el cliente.
          const otro = (conv.participants?.data ?? []).find(
            (p) => p.id && p.id !== selfId && p.id !== pageId,
          );
          const externalId = String(otro?.id ?? "");
          if (!externalId) continue;
          // Nunca re-descubrir a alguien borrado (GDPR / borrado deliberado).
          if (suprimidos.has(externalId)) continue;

          try {
            const { data: contacto } = await admin
              .from("contacts")
              .select("id, name")
              .eq("workspace_id", c.workspace_id)
              .eq("channel", c.channel)
              .eq("external_id", externalId)
              .maybeSingle();
            const retomado = cfg.dm_backfill_thread_id === conv.id;
            const completo = syncFullThread({
              hasMark: Boolean(marca),
              knownContact: Boolean(contacto),
              resuming: retomado,
              resumingFull: cfg.dm_backfill_thread_full,
            });
            hilos++;
            ingested += await syncThreadMessages({
              token,
              selfId,
              connection: c,
              threadId: conv.id,
              externalId,
              contactName:
                contacto?.name ??
                (otro?.username ? `@${otro.username}` : undefined) ??
                otro?.name ??
                undefined,
              // Un contacto que ya existe nunca abre fila nueva: si su
              // conversación fue borrada, sigue borrada. Sólo el participante
              // desconocido —el hilo que el comercio inició desde la app— se
              // crea.
              createIfMissing: !contacto,
              // La conversación completa, no sólo la franja: la primera vez que
              // se la ve entra entera.
              sinceIso: completo ? undefined : pisoIso,
              deadlineMs: connectionDeadline,
              after: retomado ? String(cfg.dm_backfill_thread_after ?? '') || undefined : undefined,
              onCheckpoint: async (after) => {
                await savePollState(admin, c.id, {
                  dm_backfill_thread_id: after ? conv.id : null,
                  dm_backfill_thread_after: after,
                  dm_backfill_thread_full: after ? completo : null,
                }, null, { complete: false });
              },
            });
          } catch (err) {
            // No seguir hacia atrás: `ultimoMirado` queda en ESTE hilo y el
            // checkpoint inclusivo obliga a reintentarlo. Continuar habría
            // guardado un borde más viejo y saltado para siempre este hueco.
            fallo = `hilo ${conv.id}: ${err instanceof Error ? err.message : String(err)}`;
            break;
          }
        }

        if (alDia || Date.now() > connectionDeadline || fallo) break;
        url = j.paging?.next ?? null;
        listAfter = url ? new URL(url).searchParams.get('after') ?? '' : '';
        paginas++;
        // Se acabaron las páginas sin cruzar el piso: no hay más historia.
        if (!url) alDia = true;
      }
    } catch (err) {
      fallo = err instanceof Error ? err.message : String(err);
    }

    // La marca sólo avanza con la pasada cerrada. Si quedó a medias, se guarda
    // dónde seguir; la marca vieja queda intacta para que nada se saltee.
    const nuevoCfg = updateMetaDmBackfillCheckpoint(cfg, {
      complete: alDia && !fallo,
      objective: objetivo,
      resumeAt: ultimoMirado,
    });
    const pending = fallo?.endsWith(': meta_thread_sync_pending');
    await savePollState(admin, c.id, {
      [META_DM_BACKFILL_MARK]: nuevoCfg[META_DM_BACKFILL_MARK] ?? null,
      [META_DM_BACKFILL_PENDING]: nuevoCfg[META_DM_BACKFILL_PENDING] ?? null,
      dm_backfill_complete: alDia && !fallo,
      dm_backfill_list_after: alDia && !fallo ? null : listAfter,
    }, pending ? null : fallo, { complete: alDia && !fallo });

    results.push({
      connection_id: c.id,
      channel: c.channel,
      ingested,
      hilos,
      al_dia: alDia && !fallo,
      ...(fallo && !pending ? { error: fallo } : {}),
    });
    if (sinTiempo) break;
  }

  // Quedarse sin tiempo con la pasada guardada NO es un fallo: la corrida
  // siguiente retoma exactamente donde quedó. El 207 se reserva para lo que sí
  // hay que mirar —una conexión que devolvió error—, porque `withCronRun` lo
  // anota como fallo y de ahí sale el aviso al panel.
  const conError = results.some((r) => r.error);
  return NextResponse.json(
    { ok: !conError, truncado: sinTiempo, results },
    { status: conError ? 207 : 200 },
  );
}

/**
 * Participantes borrados a propósito (GDPR / borrado del comercio). El borrado
 * es duro —cascadea contacto, conversación y mensajes—, así que sin esta lista
 * el descubrimiento los recrearía en cada corrida.
 *
 * Paginada: PostgREST corta en 1000 y el participante 1001 volvía solo.
 */
async function listaDeSupresion(channel: string): Promise<Set<string>> {
  const tombs = await selectAll<{ external_id: string }>(
    supabaseAdmin(),
    "deleted_meta_participants",
    (q) => q.eq("channel", channel),
    // La tabla tiene PK compuesta (channel, external_id), no columna `id`.
    // Sin este orderBy, selectAll fallaba y devolvía una lista vacía: un
    // participante borrado podía ser descubierto y creado otra vez.
    { select: "external_id", orderBy: "external_id" },
  );
  return new Set(tombs.map((t) => String(t.external_id)));
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("meta-dm-backfill", cronHandler);
