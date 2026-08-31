import { NextResponse } from "next/server";
import { listConnections } from "@/lib/channels/connections";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { selectAll } from "@/lib/db/paginate";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { syncThreadMessages, type MetaPlatform } from "@/lib/channels/meta-dm-history";
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

/** Cuánto historial mira la PRIMERA corrida de una conexión (no hay marca). */
const ARRANQUE_DIAS = 30;

/** Páginas de la lista de conversaciones (50 hilos cada una) por corrida. */
const MAX_PAGINAS_LISTA = 20;

/**
 * Techo de reloj de la corrida entera. Por debajo del timeout del reloj, para
 * terminar siempre por decisión propia y dejar la fila escrita en `cron_runs`.
 */
const PRESUPUESTO_MS = 8 * 60_000;

/** Hasta dónde ya se miró esta conexión, dentro de `config`. */
const MARCA = "dm_backfill_marca";
/** Pasada a medio terminar: dónde retomar y qué marca adoptar al cerrarla. */
const PENDIENTE = "dm_backfill_pendiente";

interface Pendiente {
  /** Sólo hilos MÁS VIEJOS que esto quedan por mirar (la lista viene desc). */
  hasta: string;
  /** La marca que se adopta cuando la pasada termine. */
  objetivo: string;
}

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
    statuses: ["connected"],
  });
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

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
    const token = decrypt(enc);

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
    const pend = leerPendiente(cfg[PENDIENTE]);
    const objetivo = pend?.objetivo ?? arranque;
    const marca = typeof cfg[MARCA] === "string" ? (cfg[MARCA] as string) : null;
    const pisoMs =
      (marca ? new Date(marca).getTime() : Date.now() - ARRANQUE_DIAS * 86_400_000) - SOLAPE_MS;
    const pisoIso = new Date(pisoMs).toISOString();
    // Techo: en una pasada reanudada, los hilos más nuevos que esto ya se
    // miraron en la corrida anterior. `>` y no `>=` para que el hilo del borde
    // se vuelva a mirar (es idempotente) en vez de saltearse si dos hilos
    // comparten `updated_time`.
    const techoMs = pend ? new Date(pend.hasta).getTime() : Infinity;

    const suprimidos = await listaDeSupresion(c.channel);

    let ingested = 0;
    let hilos = 0;
    let ultimoMirado: string | null = null;
    let alDia = false;
    let paginas = 0;
    let fallo: string | null = null;
    let url: string | null =
      `${GRAPH}/${pageId}/conversations?platform=${platform}` +
      `&fields=id,updated_time,participants&limit=50` +
      `&access_token=${encodeURIComponent(token)}`;

    try {
      while (url && paginas < MAX_PAGINAS_LISTA) {
        if (Date.now() > limite) {
          sinTiempo = true;
          break;
        }
        // `paging.next` no lleva el proof — se re-adjunta en cada página.
        const r: Response = await fetch(withAppsecretProof(url, token));
        if (!r.ok) {
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
          if (Date.now() > limite) {
            sinTiempo = true;
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
          if (cuando > techoMs) continue;

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
              sinceIso: pisoIso,
            });
          } catch (err) {
            console.warn(
              `[meta-dm-backfill] ${c.channel} hilo ${conv.id} falló:`,
              err instanceof Error ? err.message : err,
            );
          }
        }

        if (alDia || sinTiempo) break;
        url = j.paging?.next ?? null;
        paginas++;
        // Se acabaron las páginas sin cruzar el piso: no hay más historia.
        if (!url) alDia = true;
      }
    } catch (err) {
      fallo = err instanceof Error ? err.message : String(err);
    }

    // La marca sólo avanza con la pasada cerrada. Si quedó a medias, se guarda
    // dónde seguir; la marca vieja queda intacta para que nada se saltee.
    const nuevoCfg = { ...cfg } as Record<string, unknown>;
    // Cursor del barrido por contactos, que ya no existe.
    delete nuevoCfg["dm_backfill_cursor"];
    if (alDia && !fallo) {
      nuevoCfg[MARCA] = objetivo;
      delete nuevoCfg[PENDIENTE];
    } else if (ultimoMirado) {
      nuevoCfg[PENDIENTE] = { hasta: ultimoMirado, objetivo } satisfies Pendiente;
    }
    if (JSON.stringify(nuevoCfg) !== JSON.stringify(cfg)) {
      await admin.from("channel_connections").update({ config: nuevoCfg }).eq("id", c.id);
    }

    results.push({
      connection_id: c.id,
      channel: c.channel,
      ingested,
      hilos,
      al_dia: alDia,
      ...(fallo ? { error: fallo } : {}),
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

function leerPendiente(v: unknown): Pendiente | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.hasta !== "string" || typeof o.objetivo !== "string") return null;
  if (!Number.isFinite(new Date(o.hasta).getTime())) return null;
  return { hasta: o.hasta, objetivo: o.objetivo };
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
    { select: "external_id" },
  );
  return new Set(tombs.map((t) => String(t.external_id)));
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("meta-dm-backfill", cronHandler);
