import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { getAdapter } from "../registry";
import { ingestInboundEvent } from "../inbox-writer";

/**
 * Diario de entregas de WhatsApp y su relectura (backfill).
 *
 * WhatsApp Cloud API no tiene un endpoint para leer mensajes pasados, ni en
 * coexistencia: lo que no quedó guardado cuando llegó el webhook no se puede
 * volver a pedir a Meta. Por eso cada entrega que trae mensajes queda anotada en
 * `webhook_events_raw` —ya procesada, así no cuenta como pendiente y la limpieza
 * diaria la borra a los 14 días— y el backfill la vuelve a pasar por la bandeja.
 * Cubre lo que llegó y no entró: una caída de la base a mitad del proceso, un
 * mensaje que el enrutador descartó, una conexión que estaba apagada.
 */

/** Filas del diario. Las fallas siguen entrando como `channels:whatsapp`. */
export const WHATSAPP_JOURNAL_PROVIDER = "channels:whatsapp:journal";

/** Lo que dejó `captureWebhookFailure` antes de que existiera el diario. */
const FAILURE_PROVIDERS = ["channels:whatsapp", "channels:whatsapp:ingest"];

/** Un cuerpo cortado no se puede volver a leer: no vale la pena guardarlo. */
const MAX_BODY = 1_000_000;

/** Filas por página: un cuerpo de historial puede pesar cientos de KB. */
const PAGE = 50;

/** Ids por consulta de mensajes existentes (van en la URL). */
const ID_CHUNK = 100;

/** Meta puede entregar tarde; el reloj de Meta y el nuestro no coinciden al segundo. */
const RECEIVED_SLACK_BEFORE_MS = 10 * 60_000;
const RECEIVED_SLACK_AFTER_MS = 24 * 60 * 60_000;

/**
 * Reacciones, ediciones y borrados modifican otro mensaje. Releerlos fuera de
 * orden puede deshacer algo posterior (quitar una reacción que se volvió a
 * poner), y no hay mensaje nuevo que recuperar.
 */
const NOT_REPLAYABLE = new Set(["reaction", "edit", "revoke"]);

export interface JournalItem {
  id?: string;
  type?: string;
  timestamp?: string;
}

interface JournalValue {
  metadata?: { phone_number_id?: string };
  messages?: JournalItem[];
  message_echoes?: JournalItem[];
  history?: Array<{ threads?: Array<{ id?: string; messages?: JournalItem[] }> }>;
  statuses?: unknown;
  [key: string]: unknown;
}

interface JournalBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: JournalValue }>;
  }>;
}

/** Números (phone_number_id) de una entrega que trae mensajes o ecos. */
export function journalAccounts(payload: unknown): string[] {
  const accounts = new Set<string>();
  for (const entry of (payload as JournalBody | null)?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const account = value?.metadata?.phone_number_id;
      if (!account) continue;
      if (
        (change.field === "messages" && value.messages?.length) ||
        (change.field === "smb_message_echoes" && value.message_echoes?.length)
      ) {
        accounts.add(String(account));
      }
    }
  }
  return [...accounts];
}

let journalWarned = false;

/**
 * Anota la entrega para poder releerla. Una fila por número, ya procesada.
 * Nunca lanza: el diario no puede tumbar la entrada del mensaje.
 */
export async function journalWhatsappDelivery(
  db: SupabaseClient,
  args: { rawBody: string; payload: unknown; signature: string | null },
): Promise<void> {
  const accounts = journalAccounts(args.payload);
  if (accounts.length === 0 || args.rawBody.length > MAX_BODY) return;
  const now = new Date().toISOString();
  try {
    const { error } = await db.from("webhook_events_raw").insert(
      accounts.map((account_id) => ({
        provider: WHATSAPP_JOURNAL_PROVIDER,
        raw_body: args.rawBody,
        signature: args.signature,
        account_id,
        processed_at: now,
      })),
    );
    if (error && !journalWarned) {
      journalWarned = true;
      console.warn("[whatsapp/journal] no se pudo anotar la entrega:", error.message);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * La parte de una entrega que el backfill puede reconstruir para ESTE número:
 * mensajes del cliente, ecos del teléfono del comercio e historial, filtrados
 * por `keep`. Los acuses (`statuses`) se sacan: viajan en el mismo campo
 * `messages` y el adaptador los atiende primero, salteando lo demás. Devuelve
 * null si no queda nada.
 */
export function replayablePayload(
  body: JournalBody,
  phoneNumberId: string,
  keep: (item: JournalItem) => boolean,
): JournalBody | null {
  const usable = (item: JournalItem) =>
    Boolean(item?.id) && !NOT_REPLAYABLE.has(String(item.type)) && keep(item);
  const entries: NonNullable<JournalBody["entry"]> = [];
  for (const entry of body.entry ?? []) {
    const changes: Array<{ field?: string; value?: JournalValue }> = [];
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value || String(value.metadata?.phone_number_id ?? "") !== phoneNumberId) continue;
      const rest: JournalValue = { ...value };
      delete rest.statuses;
      if (change.field === "messages") {
        const messages = (value.messages ?? []).filter(usable);
        if (messages.length) changes.push({ ...change, value: { ...rest, messages } });
      } else if (change.field === "smb_message_echoes") {
        const echoes = (value.message_echoes ?? []).filter(usable);
        if (echoes.length) changes.push({ ...change, value: { ...rest, message_echoes: echoes } });
      } else if (change.field === "history") {
        const history = (value.history ?? [])
          .map((chunk) => ({
            ...chunk,
            threads: (chunk?.threads ?? [])
              .map((thread) => ({ ...thread, messages: (thread?.messages ?? []).filter(usable) }))
              .filter((thread) => thread.messages.length > 0),
          }))
          .filter((chunk) => chunk.threads.length > 0);
        if (history.length) changes.push({ ...change, value: { ...rest, history } });
      }
    }
    if (changes.length) entries.push({ ...entry, changes });
  }
  return entries.length ? { ...body, entry: entries } : null;
}

function itemIds(body: JournalBody): string[] {
  const ids: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const item of [...(value.messages ?? []), ...(value.message_echoes ?? [])]) {
        if (item.id) ids.push(item.id);
      }
      for (const chunk of value.history ?? []) {
        for (const thread of chunk.threads ?? []) {
          for (const item of thread.messages ?? []) if (item.id) ids.push(item.id);
        }
      }
    }
  }
  return ids;
}

/**
 * Los ids que ya están en la cuenta, en cualquier conversación. El mismo
 * criterio que la idempotencia de `ingestInboundEvent`, adelantado para no
 * volver a bajar la media de algo que ya está guardado.
 */
async function knownMessageIds(
  db: SupabaseClient,
  workspaceId: string,
  ids: string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const { data, error } = await db
      .from("messages")
      .select("message_id, conversations!inner(workspace_id)")
      .in("message_id", unique.slice(i, i + ID_CHUNK))
      .eq("conversations.workspace_id", workspaceId);
    if (error) throw new Error(`message lookup: ${error.code ?? error.message}`);
    for (const row of (data ?? []) as Array<{ message_id?: string | null }>) {
      if (row.message_id) known.add(row.message_id);
    }
  }
  return known;
}

type Source = "journal" | "failures";

async function readPage(
  db: SupabaseClient,
  source: Source,
  args: { phoneNumberId: string; fromIso: string; toIso: string; offset: number },
): Promise<Array<{ raw_body: string }>> {
  let query = db.from("webhook_events_raw").select("id, raw_body");
  query =
    source === "journal"
      ? query.eq("provider", WHATSAPP_JOURNAL_PROVIDER).eq("account_id", args.phoneNumberId)
      : query
          .in("provider", FAILURE_PROVIDERS)
          .is("processed_at", null)
          .ilike("raw_body", `%${args.phoneNumberId}%`);
  const { data, error } = await query
    .gte("received_at", args.fromIso)
    .lte("received_at", args.toIso)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })
    .range(args.offset, args.offset + PAGE - 1);
  if (error) throw new Error(`${source} read: ${error.code ?? error.message}`);
  return (data ?? []) as Array<{ raw_body: string }>;
}

/** Un cuerpo cortado por la captura de fallas no se puede leer: se saltea. */
function parseBody(raw: string): JournalBody | null {
  try {
    return JSON.parse(raw) as JournalBody;
  } catch {
    return null;
  }
}

/**
 * Backfill de una conexión de WhatsApp, coexistencia o no: relee las entregas
 * del diario (y las fallas capturadas) de su número y hace entrar los mensajes
 * con fecha dentro de la ventana que todavía no están. Todo entra como
 * histórico: no suma no leídos ni despierta a la IA, las automatizaciones o los
 * flujos. Idempotente.
 */
export async function backfillWhatsappConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
  window: { sinceIso: string; untilIso: string },
): Promise<{ ingested: number; error?: string }> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const phoneNumberId = String(cfg.phone_number_id ?? connection.external_account_id ?? "");
  if (!/^\d+$/.test(phoneNumberId)) return { ingested: 0, error: "missing_config" };

  const sinceMs = Date.parse(window.sinceIso);
  const untilMs = Date.parse(window.untilIso);
  const fromIso = new Date(sinceMs - RECEIVED_SLACK_BEFORE_MS).toISOString();
  const toIso = new Date(
    Math.min(untilMs + RECEIVED_SLACK_AFTER_MS, Date.now() + 60_000),
  ).toISOString();
  const inWindow = (item: JournalItem) => {
    const at = Number(item.timestamp) * 1000;
    return Number.isFinite(at) && at >= sinceMs && at <= untilMs;
  };

  const adapter = getAdapter("whatsapp");
  const request = new Request("https://riverz.co/api/messages/backfill");
  // Ids ya resueltos en esta corrida: guardados de antes o ya intentados. La
  // misma entrega puede estar en el diario y en las fallas, y Meta reentrega;
  // sin esto la media se bajaría dos veces.
  const handled = new Set<string>();
  let ingested = 0;
  let error: string | undefined;
  const fail = (err: unknown) => {
    // Un mensaje que no entra no frena al resto.
    console.error("[whatsapp/journal] relectura fallida", { connectionId: connection.id, err });
    error ??= "replay_failed";
  };

  for (const source of ["journal", "failures"] as const) {
    for (let offset = 0; ; offset += PAGE) {
      let rows: Array<{ raw_body: string }>;
      try {
        rows = await readPage(db, source, { phoneNumberId, fromIso, toIso, offset });
      } catch (err) {
        console.error("[whatsapp/journal] lectura fallida", { connectionId: connection.id, err });
        error ??= source === "journal" ? "journal_unavailable" : "journal_read_failed";
        break;
      }
      const candidates: JournalBody[] = [];
      for (const row of rows) {
        const body = parseBody(row.raw_body);
        const candidate = body && replayablePayload(body, phoneNumberId, inWindow);
        if (candidate) candidates.push(candidate);
      }
      try {
        const pending = candidates.flatMap(itemIds).filter((id) => !handled.has(id));
        for (const id of await knownMessageIds(db, connection.workspace_id, pending)) {
          handled.add(id);
        }
      } catch (err) {
        fail(err);
        candidates.length = 0;
      }
      for (const candidate of candidates) {
        const payload = replayablePayload(
          candidate,
          phoneNumberId,
          (item) => !handled.has(String(item.id)),
        );
        if (!payload) continue;
        for (const id of itemIds(payload)) handled.add(id);
        let events: InboundEvent[];
        try {
          events = await adapter.parseWebhook({ request, rawBody: "", payload }, connection);
        } catch (err) {
          fail(err);
          continue;
        }
        for (const event of events) {
          try {
            const saved = await ingestInboundEvent(db, {
              ...event,
              historical: true,
              suppressAutoReply: true,
            });
            if (saved) ingested++;
          } catch (err) {
            fail(err);
          }
        }
      }
      if (rows.length < PAGE) break;
    }
  }
  return error ? { ingested, error } : { ingested };
}
