import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { getAdapter } from "../registry";
import { ingestInboundEvent } from "../inbox-writer";
import { isMediaPlaceholderText } from "../display";

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

/**
 * Tope de cada fila del diario. Un cuerpo más grande no se descarta: se parte
 * en varias filas (`journalBodies`). Antes se descartaba, y el historial de
 * coexistencia —el que más pesa y el que Meta manda una sola vez— era justo el
 * que podía quedar sin copia si el proceso se reiniciaba después de acusar
 * recibo.
 */
const MAX_BODY = 1_000_000;

/**
 * Un solo hilo del historial puede pasar el tope por su cuenta: se guarda en
 * una fila propia hasta acá. La columna es TEXT y admite más; el límite real es
 * la memoria de la relectura, que baja de a PAGE filas.
 */
const MAX_UNIT_BODY = 8_000_000;

/** Filas por página: un cuerpo de historial puede pesar cientos de KB. */
const PAGE = 50;

/** Ids por consulta (van en la URL). */
const ID_CHUNK = 100;

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
  /** Quien escribe: el cliente en los mensajes entrantes. */
  from?: string;
  /** El cliente en los ecos del teléfono del comercio. */
  to?: string;
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

/**
 * Números (phone_number_id) de una entrega que trae mensajes, ecos o historial.
 * El historial también: Meta lo manda una sola vez, y sin copia un archivo que
 * no entra no se recupera nunca.
 */
export function journalAccounts(payload: unknown): string[] {
  const accounts = new Set<string>();
  for (const entry of (payload as JournalBody | null)?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const account = value?.metadata?.phone_number_id;
      if (!account) continue;
      if (
        (change.field === "messages" && value.messages?.length) ||
        (change.field === "smb_message_echoes" && value.message_echoes?.length) ||
        (change.field === "history" && value.history?.length)
      ) {
        accounts.add(String(account));
      }
    }
  }
  return [...accounts];
}

let journalWarned = false;

/** Una pieza de una entrega partida: un cambio, o un hilo de un cambio de historial. */
interface JournalUnit {
  entryId?: string;
  field?: string;
  value: JournalValue;
}

/**
 * Parte en piezas lo que una entrega trae para ESTE número: cada cambio de
 * mensajes o ecos entero, y el historial de a un hilo, con los metadatos de su
 * tanda (fase, avance, errores) repetidos en cada pieza.
 */
function journalUnits(body: JournalBody, account: string): JournalUnit[] {
  const units: JournalUnit[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value || String(value.metadata?.phone_number_id ?? "") !== account) continue;
      if (change.field === "history") {
        const rest: JournalValue = { ...value };
        delete rest.history;
        for (const chunk of value.history ?? []) {
          const { threads, ...chunkRest } = chunk ?? {};
          // Una tanda sin hilos (por ejemplo, sólo el error de Meta) va entera.
          const parts = threads?.length ? threads.map((thread) => [thread]) : [undefined];
          for (const part of parts) {
            units.push({
              entryId: entry.id,
              field: change.field,
              value: { ...rest, history: [part ? { ...chunkRest, threads: part } : chunkRest] },
            });
          }
        }
      } else if (change.field === "messages" || change.field === "smb_message_echoes") {
        units.push({ entryId: entry.id, field: change.field, value });
      }
    }
  }
  return units;
}

/** Arma un cuerpo con estas piezas, agrupadas por `entry` como las manda Meta. */
function bodyOf(object: string | undefined, units: JournalUnit[]): string {
  const entries: NonNullable<JournalBody["entry"]> = [];
  for (const unit of units) {
    let entry = entries[entries.length - 1];
    if (!entry || entry.id !== unit.entryId) {
      entry = { id: unit.entryId, changes: [] };
      entries.push(entry);
    }
    entry.changes?.push({ field: unit.field, value: unit.value });
  }
  return JSON.stringify({ object, entry: entries });
}

/**
 * Las filas del diario para una entrega: una por número. Un cuerpo que pasa el
 * tope se parte en varias filas por número, cada una un JSON completo que la
 * relectura procesa como cualquier otra entrega. Las partes no llevan firma:
 * la de Meta es del cuerpo original. Sólo se pierde un hilo que por sí solo
 * pase MAX_UNIT_BODY.
 */
export function journalBodies(
  rawBody: string,
  payload: unknown,
): Array<{ account: string; body: string; signed: boolean }> {
  const accounts = journalAccounts(payload);
  if (rawBody.length <= MAX_BODY) {
    return accounts.map((account) => ({ account, body: rawBody, signed: true }));
  }
  const body = payload as JournalBody;
  const rows: Array<{ account: string; body: string; signed: boolean }> = [];
  for (const account of accounts) {
    let batch: JournalUnit[] = [];
    let size = 0;
    const flush = () => {
      if (batch.length) rows.push({ account, body: bodyOf(body.object, batch), signed: false });
      batch = [];
      size = 0;
    };
    for (const unit of journalUnits(body, account)) {
      // El envoltorio de cada pieza suma unos pocos bytes: el margen los cubre.
      const unitSize = JSON.stringify(unit.value).length + 200;
      if (unitSize > MAX_UNIT_BODY) {
        console.warn("[whatsapp/journal] un hilo del historial excede el tope y no se anota", {
          account,
          size: unitSize,
        });
        continue;
      }
      if (size + unitSize > MAX_BODY) flush();
      batch.push(unit);
      size += unitSize;
    }
    flush();
  }
  return rows;
}

/**
 * Anota la entrega para poder releerla. Una fila por número (o varias, si la
 * entrega es enorme), ya procesada. Nunca lanza: el diario no puede tumbar la
 * entrada del mensaje.
 */
export async function journalWhatsappDelivery(
  db: SupabaseClient,
  args: { rawBody: string; payload: unknown; signature: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const rows = journalBodies(args.rawBody, args.payload);
    if (rows.length === 0) return;
    const { error } = await db.from("webhook_events_raw").insert(
      rows.map(({ account, body, signed }) => ({
        provider: WHATSAPP_JOURNAL_PROVIDER,
        raw_body: body,
        signature: signed ? args.signature : null,
        account_id: account,
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
 * por `keep`, que recibe también el contacto de la conversación. Los acuses
 * (`statuses`) se sacan: viajan en el mismo campo `messages` y el adaptador los
 * atiende primero, salteando lo demás. Devuelve null si no queda nada.
 */
export function replayablePayload(
  body: JournalBody,
  phoneNumberId: string,
  keep: (item: JournalItem, contact: string) => boolean,
): JournalBody | null {
  const usable = (contactOf: (item: JournalItem) => unknown) => (item: JournalItem) =>
    Boolean(item?.id) &&
    !NOT_REPLAYABLE.has(String(item.type)) &&
    keep(item, String(contactOf(item) ?? ""));
  const entries: NonNullable<JournalBody["entry"]> = [];
  for (const entry of body.entry ?? []) {
    const changes: Array<{ field?: string; value?: JournalValue }> = [];
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value || String(value.metadata?.phone_number_id ?? "") !== phoneNumberId) continue;
      const rest: JournalValue = { ...value };
      delete rest.statuses;
      if (change.field === "messages") {
        const messages = (value.messages ?? []).filter(usable((item) => item.from));
        if (messages.length) changes.push({ ...change, value: { ...rest, messages } });
      } else if (change.field === "smb_message_echoes") {
        const echoes = (value.message_echoes ?? []).filter(usable((item) => item.to));
        if (echoes.length) changes.push({ ...change, value: { ...rest, message_echoes: echoes } });
      } else if (change.field === "history") {
        const history = (value.history ?? [])
          .map((chunk) => ({
            ...chunk,
            threads: (chunk?.threads ?? [])
              .map((thread) => ({
                ...thread,
                messages: (thread?.messages ?? []).filter(usable(() => thread?.id)),
              }))
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

/** Anota en `first` el primer mensaje (ms) de cada contacto de este número. */
export function recordFirstMessages(
  body: JournalBody,
  phoneNumberId: string,
  first: Map<string, number>,
): void {
  // Mismo recorrido que la relectura: sólo mira, no arma nada.
  replayablePayload(body, phoneNumberId, (item, contact) => {
    const at = Number(item.timestamp) * 1000;
    if (contact && Number.isFinite(at) && at < (first.get(contact) ?? Infinity)) {
      first.set(contact, at);
    }
    return false;
  });
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
 *
 * Una fila que todavía espera su archivo —el marcador del historial de
 * coexistencia o un "[Imagen]" cuya descarga falló, sin `media_url`— NO cuenta
 * como guardada: si la saltáramos, la entrega que trae el archivo nunca
 * llegaría a `ingestInboundEvent`, que es quien completa la fila.
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
      .select("message_id, content_text, media_url, conversations!inner(workspace_id)")
      .in("message_id", unique.slice(i, i + ID_CHUNK))
      .eq("conversations.workspace_id", workspaceId);
    if (error) throw new Error(`message lookup: ${error.code ?? error.message}`);
    for (const row of (data ?? []) as Array<{
      message_id?: string | null;
      content_text?: string | null;
      media_url?: string | null;
    }>) {
      if (!row.message_id) continue;
      if (!row.media_url && isMediaPlaceholderText(row.content_text)) continue;
      known.add(row.message_id);
    }
  }
  return known;
}

/** El evento quedó sin su archivo: otra entrega con el mismo id puede traerlo. */
function stillMissingMedia(event: InboundEvent): boolean {
  return !event.attachments?.some((a) => a.url) && isMediaPlaceholderText(event.text);
}

/**
 * De estos contactos, los que ya tienen en la bandeja un mensaje anterior a
 * `sinceIso`: su conversación empezó antes, aunque el diario no lo muestre.
 */
async function startedEarlier(
  db: SupabaseClient,
  workspaceId: string,
  contacts: string[],
  sinceIso: string,
): Promise<Set<string>> {
  const earlier = new Set<string>();
  for (let i = 0; i < contacts.length; i += ID_CHUNK) {
    const { data: found, error } = await db
      .from("contacts")
      .select("id, external_id")
      .eq("workspace_id", workspaceId)
      .eq("channel", "whatsapp")
      .in("external_id", contacts.slice(i, i + ID_CHUNK));
    if (error) throw new Error(`contact lookup: ${error.code ?? error.message}`);
    const byId = new Map(
      ((found ?? []) as Array<{ id: string; external_id: string }>).map((c) => [c.id, c.external_id]),
    );
    if (byId.size === 0) continue;
    const { data: convs, error: convError } = await db
      .from("conversations")
      .select("id, contact_id")
      .eq("workspace_id", workspaceId)
      .eq("channel", "whatsapp")
      .in("contact_id", [...byId.keys()]);
    if (convError) throw new Error(`conversation lookup: ${convError.code ?? convError.message}`);
    for (const conv of (convs ?? []) as Array<{ id: string; contact_id: string }>) {
      const contact = byId.get(conv.contact_id);
      if (!contact || earlier.has(contact)) continue;
      const { data: older, error: olderError } = await db
        .from("messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .lt("created_at", sinceIso)
        .limit(1);
      if (olderError) throw new Error(`message lookup: ${olderError.code ?? olderError.message}`);
      if (older?.length) earlier.add(contact);
    }
  }
  return earlier;
}

type Source = "journal" | "failures";

async function readPage(
  db: SupabaseClient,
  source: Source,
  phoneNumberId: string,
  offset: number,
): Promise<Array<{ raw_body: string }>> {
  let query = db.from("webhook_events_raw").select("id, raw_body");
  query =
    source === "journal"
      ? query.eq("provider", WHATSAPP_JOURNAL_PROVIDER).eq("account_id", phoneNumberId)
      : query
          .in("provider", FAILURE_PROVIDERS)
          .is("processed_at", null)
          .ilike("raw_body", `%${phoneNumberId}%`);
  const { data, error } = await query
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE - 1);
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
 * Recorre todas las entregas del número —el diario y las fallas capturadas—,
 * de a una página. Devuelve el código de error si alguna fuente no se pudo leer.
 */
async function forEachDelivery(
  db: SupabaseClient,
  phoneNumberId: string,
  onBody: (body: JournalBody) => Promise<void> | void,
): Promise<string | undefined> {
  let error: string | undefined;
  for (const source of ["journal", "failures"] as const) {
    for (let offset = 0; ; offset += PAGE) {
      let rows: Array<{ raw_body: string }>;
      try {
        rows = await readPage(db, source, phoneNumberId, offset);
      } catch (err) {
        console.error("[whatsapp/journal] lectura fallida", { phoneNumberId, err });
        error ??= source === "journal" ? "journal_unavailable" : "journal_read_failed";
        break;
      }
      for (const row of rows) {
        const body = parseBody(row.raw_body);
        if (body) await onBody(body);
      }
      if (rows.length < PAGE) break;
    }
  }
  return error;
}

/**
 * Backfill de una conexión de WhatsApp, coexistencia o no. Como en Instagram y
 * Messenger, el rango elige QUÉ conversaciones: las que empezaron en él. Cada
 * una entra completa con todo lo que el diario tiene de ese contacto; una que
 * empezó antes —en el diario o en la bandeja— no entra. Todo entra como
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
  let ingested = 0;
  let error: string | undefined;
  const fail = (err: unknown) => {
    // Un mensaje que no entra no frena al resto.
    console.error("[whatsapp/journal] relectura fallida", { connectionId: connection.id, err });
    error ??= "replay_failed";
  };
  const done = () => (error ? { ingested, error } : { ingested });

  // 1. Cuándo empezó cada conversación según el diario.
  const first = new Map<string, number>();
  error = await forEachDelivery(db, phoneNumberId, (body) =>
    recordFirstMessages(body, phoneNumberId, first),
  );
  const candidates = [...first]
    .filter(([, at]) => at >= sinceMs && at <= untilMs)
    .map(([contact]) => contact);
  if (candidates.length === 0) return done();

  // 2. Sin las que la bandeja ya tenía de antes.
  let chosen: Set<string>;
  try {
    const earlier = await startedEarlier(db, connection.workspace_id, candidates, window.sinceIso);
    chosen = new Set(candidates.filter((contact) => !earlier.has(contact)));
  } catch (err) {
    fail(err);
    return done();
  }
  if (chosen.size === 0) return done();

  // 3. Cada una completa.
  const adapter = getAdapter("whatsapp");
  const request = new Request("https://riverz.co/api/messages/backfill");
  // Ids ya resueltos en esta corrida: guardados de antes o ya intentados. La
  // misma entrega puede estar en el diario y en las fallas, y Meta reentrega;
  // sin esto la media se bajaría dos veces.
  const handled = new Set<string>();
  const replayError = await forEachDelivery(db, phoneNumberId, async (body) => {
    const candidate = replayablePayload(body, phoneNumberId, (_item, contact) =>
      chosen.has(contact),
    );
    if (!candidate) return;
    try {
      const pending = itemIds(candidate).filter((id) => !handled.has(id));
      for (const id of await knownMessageIds(db, connection.workspace_id, pending)) {
        handled.add(id);
      }
    } catch (err) {
      fail(err);
      return;
    }
    const payload = replayablePayload(candidate, phoneNumberId, (item) => !handled.has(String(item.id)));
    if (!payload) return;
    for (const id of itemIds(payload)) handled.add(id);
    let events: InboundEvent[];
    try {
      events = await adapter.parseWebhook({ request, rawBody: "", payload }, connection);
    } catch (err) {
      fail(err);
      return;
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
      // El historial manda el archivo en OTRA entrega con el mismo id. Si esta
      // trajo sólo el marcador, el id queda abierto para la que lo trae.
      if (event.externalMessageId && stillMissingMedia(event)) {
        handled.delete(event.externalMessageId);
      }
    }
  });
  error ??= replayError;
  return done();
}
