import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt } from "./encryption";
import { withAppsecretProof } from "./meta-graph";
import { COMMENT_DELETED_TEXT } from "./display";
import { listConnections } from "./connections";

/**
 * Two-way comment sync — reflect on Facebook/Instagram back into the inbox.
 *
 * The inbox already pushes moderation OUT (reply / hide / delete / like via
 * `/api/messages/moderate`). This module pulls the reverse direction: when a
 * comment (or our own reply) is deleted, hidden, or edited natively on FB/IG,
 * the stored `messages` row is updated to match so the inbox never shows a
 * comment that no longer exists (or shows public one the merchant hid).
 *
 * - Facebook pushes these as `feed` webhook events with a `verb`
 *   (remove/hide/unhide/edited) → handled in real time by the fb_comment
 *   adapter, which calls {@link applyCommentLifecycle}.
 * - Instagram does NOT push comment delete/hide/like events, so
 *   {@link reconcileCommentsForConnection} re-reads recent comments from the
 *   Graph API on a cron and converges the stored rows. It also covers FB as a
 *   safety net for any webhook Meta dropped.
 *
 * `messages` is in the realtime publication, so every UPDATE here propagates
 * live to any open inbox pane.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
/** How far back to reconcile. Comments older than this are effectively frozen
 *  — moderation almost always happens within days of posting, and an unbounded
 *  window would make each run scan the whole history. */
const RECONCILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Cap the Graph reads per connection per run so a busy account can't blow the
 *  cron's time budget; the next run picks up the rest (newest first). */
const MAX_PER_RUN = 300;
/** Parallel Graph reads. Small enough to stay well under Meta's rate limits. */
const CONCURRENCY = 6;

export type Lifecycle = "delete" | "hide" | "unhide" | "edit" | "like" | "unlike";

export interface CommentRow {
  id: string;
  message_id: string | null;
  is_hidden: boolean | null;
  /** Migración 169. Sólo TikTok lo informa hoy; en Meta queda NULL. */
  is_liked?: boolean | null;
  status: string | null;
  content_text: string | null;
  /** Migración 208: cuándo lo reescribió el comercio desde la bandeja. */
  edited_at?: string | null;
}

/**
 * Apply a lifecycle change (delete / hide / unhide / edit) to a stored comment
 * identified by its external Graph id, scoped to one workspace. Idempotent —
 * re-applying the same state is a no-op. Used by the FB webhook (real time) and
 * the reconcile cron.
 */
export async function applyCommentLifecycle(
  db: SupabaseClient,
  input: {
    channel: "fb_comment" | "ig_comment" | "tiktok_comment";
    workspaceId: string;
    commentExternalId: string;
    kind: Lifecycle;
    /** New body for `edit`. */
    text?: string;
  },
): Promise<boolean> {
  const { data: rows } = await db
    .from("messages")
    .select(
      "id, is_hidden, is_liked, status, content_text, edited_at, conversations!inner(workspace_id)",
    )
    .eq("channel", input.channel)
    .eq("message_id", input.commentExternalId)
    .eq("conversations.workspace_id", input.workspaceId);
  const list = (rows ?? []) as unknown as CommentRow[];
  if (list.length === 0) return false;

  let changed = false;
  for (const row of list) {
    const patch = patchFor(row, input.kind, input.text);
    if (!patch) continue;
    // Este camino es SIEMPRE la red: el webhook o la conciliación traen lo que
    // pasó en Instagram/Facebook/TikTok. Si el comentario aparece oculto y no
    // lo ocultamos nosotros, lo ocultó alguien desde la app de la red.
    const conRastro =
      input.kind === "hide"
        ? { ...patch, hidden_by: "red", hidden_at: new Date().toISOString() }
        : input.kind === "unhide"
          ? {
              ...patch,
              hidden_by: null,
              hidden_by_user_id: null,
              hidden_reason: null,
              hidden_at: null,
            }
          : patch;
    const { error } = await db.from("messages").update(conRastro).eq("id", row.id);
    if (error) {
      console.warn("[comment-sync] update failed:", error.message);
      continue;
    }
    changed = true;
  }
  return changed;
}

/** Ventana en la que nuestra edición gana sobre una lectura de Graph. */
const EDICION_RECIENTE_MS = 2 * 60 * 1000;

function editadoRecienPorNosotros(row: CommentRow): boolean {
  if (!row.edited_at) return false;
  const at = Date.parse(row.edited_at);
  return Number.isFinite(at) && Date.now() - at < EDICION_RECIENTE_MS;
}

export function patchFor(
  row: CommentRow,
  kind: Lifecycle,
  text?: string,
): Record<string, unknown> | null {
  const isDeleted =
    row.status === "failed" && (row.content_text ?? "").trim() === COMMENT_DELETED_TEXT;
  switch (kind) {
    case "delete":
      if (isDeleted) return null;
      return { status: "failed", content_text: COMMENT_DELETED_TEXT };
    case "hide":
      if (isDeleted || row.is_hidden === true) return null;
      return { is_hidden: true };
    case "unhide":
      if (isDeleted || row.is_hidden === false) return null;
      return { is_hidden: false };
    case "edit": {
      // Never resurrect a deleted comment, and don't blank the text.
      if (isDeleted || !text || text === row.content_text) return null;
      // Carrera con nuestra propia edición: la bandeja escribe primero en
      // Facebook y después la fila. Una lectura de Graph que salió ANTES de esa
      // escritura trae el texto viejo y desharía el cambio sin que nadie lo
      // pida. Pasada la ventana manda Facebook — puede haberlo editado una
      // persona desde ahí.
      if (editadoRecienPorNosotros(row)) return null;
      return { content_text: text };
    }
    // El me gusta del comercio (migración 169): lo informa TikTok en cada
    // lectura, así que la barra de moderación puede nacer con el estado real
    // en vez de siempre apagado.
    case "like":
      if (isDeleted || row.is_liked === true) return null;
      return { is_liked: true };
    case "unlike":
      if (isDeleted || row.is_liked === false) return null;
      return { is_liked: false };
    default:
      return null;
  }
}

/**
 * Re-read recent comments for one FB/IG connection from the Graph API and
 * converge the stored rows: a comment that no longer exists is marked deleted;
 * a comment whose hidden state changed is updated. Covers both customer
 * comments and our own replies (both are `messages` rows keyed by the Graph
 * comment id).
 */
export async function reconcileCommentsForConnection(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<{ checked: number; deleted: number; hiddenChanged: number; skipped: boolean }> {
  const channel = connection.channel;
  if (channel !== "fb_comment" && channel !== "ig_comment") {
    return { checked: 0, deleted: 0, hiddenChanged: 0, skipped: true };
  }
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? "");
  if (!enc) return { checked: 0, deleted: 0, hiddenChanged: 0, skipped: true };
  let token: string;
  try {
    token = decrypt(enc);
  } catch {
    return { checked: 0, deleted: 0, hiddenChanged: 0, skipped: true };
  }

  const sinceIso = new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString();
  const { data: rows } = await db
    .from("messages")
    .select(
      "id, message_id, is_hidden, status, content_text, edited_at, conversations!inner(connection_id)",
    )
    .eq("channel", channel)
    .eq("conversations.connection_id", connection.id)
    .not("message_id", "is", null)
    .neq("status", "failed") // already-deleted rows need no re-check
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_PER_RUN);
  const list = (rows ?? []) as unknown as CommentRow[];
  if (list.length === 0) return { checked: 0, deleted: 0, hiddenChanged: 0, skipped: false };

  // Probe every comment first, THEN decide. If a large share come back
  // "not found" it's almost certainly a token that lost the comment scope, not
  // a mass deletion — bailing on the deletes prevents wiping the inbox.
  const probes = await mapWithConcurrency(list, CONCURRENCY, async (row) => ({
    row,
    result: await probeComment(channel, row.message_id!, token),
  }));

  const notFound = probes.filter((p) => p.result.kind === "gone").length;
  const suspiciousMassLoss = probes.length >= 5 && notFound / probes.length > 0.5;

  let deleted = 0;
  let hiddenChanged = 0;
  for (const { row, result } of probes) {
    if (result.kind === "gone") {
      if (suspiciousMassLoss) continue; // safety valve — don't mark deleted
      const ok = await applyCommentLifecycle(db, {
        channel,
        workspaceId: connWorkspaceId(connection),
        commentExternalId: row.message_id!,
        kind: "delete",
      });
      if (ok) deleted++;
    } else if (result.kind === "ok") {
      const desired = result.hidden;
      if (desired !== null && desired !== (row.is_hidden ?? false)) {
        const ok = await applyCommentLifecycle(db, {
          channel,
          workspaceId: connWorkspaceId(connection),
          commentExternalId: row.message_id!,
          kind: desired ? "hide" : "unhide",
        });
        if (ok) hiddenChanged++;
      }
    }
    // result.kind === "error" → transient (rate limit / token) → leave as-is.
  }

  if (suspiciousMassLoss) {
    console.warn(
      `[comment-sync] ${notFound}/${probes.length} comments not found on ${channel} ` +
        `(connection ${connection.id}) — skipped deletions (likely a scope/token issue).`,
    );
  }
  return { checked: probes.length, deleted, hiddenChanged, skipped: false };
}

function connWorkspaceId(connection: ChannelConnection): string {
  return connection.workspace_id;
}

type Probe =
  | { kind: "ok"; hidden: boolean | null }
  | { kind: "gone" }
  | { kind: "error" };

/** GET the comment node and read its hidden state, or classify it as deleted. */
async function probeComment(
  channel: "fb_comment" | "ig_comment",
  commentId: string,
  token: string,
): Promise<Probe> {
  // FB comments expose `is_hidden`; IG comments expose `hidden`.
  const field = channel === "ig_comment" ? "hidden" : "is_hidden";
  const url = withAppsecretProof(
    `${GRAPH}/${commentId}?fields=${field}&access_token=${encodeURIComponent(token)}`,
    token,
  );
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { kind: "error" };
  }
  const text = await res.text().catch(() => "");
  if (res.ok) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const raw = json[field];
      return { kind: "ok", hidden: typeof raw === "boolean" ? raw : null };
    } catch {
      return { kind: "ok", hidden: null };
    }
  }
  // Non-2xx — is it a genuine "the object is gone" or a transient error?
  let code: number | undefined;
  let subcode: number | undefined;
  try {
    const err = (JSON.parse(text) as { error?: { code?: number; error_subcode?: number } }).error;
    code = err?.code;
    subcode = err?.error_subcode;
  } catch {
    /* non-JSON body */
  }
  // code 100 / subcode 33 = "object does not exist, cannot be loaded, or does
  // not support this operation" — the signature Graph returns for a deleted
  // comment. Anything else (190 token, 4/17/32/613 rate limits, 10/200
  // permission) is treated as transient so we never delete on the wrong signal.
  if (code === 100 && (subcode === 33 || subcode === undefined)) {
    return { kind: "gone" };
  }
  return { kind: "error" };
}

/** Reconcile every connected FB/IG comment connection. Entry point for the cron. */
export async function reconcileAllCommentConnections(
  db: SupabaseClient,
): Promise<{
  ok: boolean;
  connections: number;
  checked: number;
  deleted: number;
  hiddenChanged: number;
}> {
  // error/expired incluidos: siguen recibiendo webhooks de comentarios (la
  // suscripción es a nivel app, no de token), así que sus borrados y ocultados
  // igual hay que conciliarlos. Un token muerto sólo hace fallar la lectura de
  // Graph → se trata como transitorio y se saltea.
  const list = await listConnections(db, {
    channels: ["fb_comment", "ig_comment"],
  });

  let checked = 0;
  let deleted = 0;
  let hiddenChanged = 0;
  for (const c of list) {
    try {
      const r = await reconcileCommentsForConnection(db, c);
      checked += r.checked;
      deleted += r.deleted;
      hiddenChanged += r.hiddenChanged;
    } catch (err) {
      console.error("[comment-sync] connection failed:", c.id, err);
    }
  }
  return { ok: true, connections: list.length, checked, deleted, hiddenChanged };
}

/** Run `fn` over `items` with a bounded number of concurrent promises. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
