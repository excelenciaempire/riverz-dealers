/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from "./admin-client";
import {
  engineSendCtaUrl,
  engineSendDocument,
  engineSendImage,
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendText,
  engineSendVideo,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import { runShopifyLookup } from "./shopify-lookup";
import { classifyIntent } from "./ai-intent";
import { resolveWorkspaceOwnerUserId } from "@/lib/workspaces/owner";
import {
  type AiIntentNodeConfig,
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunCallFrame,
  type FlowRunRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendCtaUrlNodeConfig,
  type SendDocumentNodeConfig,
  type SendImageNodeConfig,
  type SendListNodeConfig,
  type SendMessageNodeConfig,
  type SendVideoNodeConfig,
  type SetTagNodeConfig,
  type ShopifyLookupNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
  type WaitNodeConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "send_image" ||
    node_type === "send_video" ||
    node_type === "send_document" ||
    node_type === "send_cta_url" ||
    node_type === "condition" ||
    node_type === "set_tag" ||
    node_type === "shopify_lookup"
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input" ||
    node_type === "ai_intent" ||
    node_type === "wait" ||
    // customer_reply suspende sin enviar nada — espera el próximo
    // mensaje inbound y avanza, sin capturar nada.
    node_type === "customer_reply"
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
    case "not_contains":
      if (args.subjectValue === undefined) return true;
      return !args.subjectValue.includes(args.configValue ?? "");
    case "regex_match": {
      if (args.subjectValue === undefined) return false;
      const pattern = args.configValue ?? "";
      if (!pattern) return false;
      try {
        const re = new RegExp(`^(?:${pattern})$`);
        return re.test(args.subjectValue);
      } catch {
        return false;
      }
    }
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  userId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` makes
  // "two active runs for one contact" impossible by design. But a
  // future migration glitch or manual SQL could create one, and
  // .maybeSingle() throws on >1 row — which would kill dispatch for
  // that contact's webhook entirely. .limit(1) is forgiving: pick the
  // newest, let the cron sweep clean up the stale one.
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[flows] loadActiveRunForContact error:", error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  return rows[0] ?? null;
}

async function loadFlow(
  db: AdminClient,
  flowId: string,
): Promise<FlowRow | null> {
  const { data, error } = await db
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  if (error) {
    console.error("[flows] loadFlow error:", error.message);
    return null;
  }
  return (data as FlowRow | null) ?? null;
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
/**
 * Devuelve el flow_id que el run está EJECUTANDO en este momento.
 * Si call_stack está vacía, es el flujo raíz del run; si no, es el
 * flujo del frame superior (el subflujo más profundo). Lo usan los
 * dispatchers para cargar los nodos correctos en la resume path
 * (cuando un cliente responde a un collect_input dentro de un
 * subflujo, los nodos del flujo raíz no contienen ese node_key).
 */
function getActiveFlowIdForRun(run: FlowRunRow): string {
  const stack = Array.isArray(run.call_stack) ? run.call_stack : [];
  if (stack.length === 0) return run.flow_id;
  return stack[stack.length - 1].flow_id;
}

async function loadAllNodes(
  db: AdminClient,
  flowId: string,
): Promise<Map<string, FlowNodeRow>> {
  const { data, error } = await db
    .from("flow_nodes")
    .select("*")
    .eq("flow_id", flowId);
  if (error) {
    console.error("[flows] loadAllNodes error:", error.message);
    return new Map();
  }
  const map = new Map<string, FlowNodeRow>();
  for (const row of (data ?? []) as FlowNodeRow[]) {
    map.set(row.node_key, row);
  }
  return map;
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", error.message);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  userId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact (active + historical). Bounded
  // by how many flows the customer has been through — small.
  const { data: runs } = await db
    .from("flow_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("contact_id", contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r) => (r as { id: string }).id);

  const { count } = await db
    .from("flow_run_events")
    .select("id", { count: "exact", head: true })
    .in("flow_run_id", runIds)
    .eq("event_type", "reply_received")
    .filter("payload->>meta_message_id", "eq", metaMessageId);
  return (count ?? 0) > 0;
}

async function findEntryFlow(
  db: AdminClient,
  userId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;

  // Pull all active flows for this user. Active set is bounded (the
  // builder discourages double-trigger overlap; partial index makes
  // the lookup index-supported).
  const { data: flows, error } = await db
    .from("flows")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !flows) return null;

  const typed = flows as FlowRow[];
  for (const flow of typed) {
    if (flow.trigger_type === "keyword") {
      if (matchesKeywordTrigger(
        message.text,
        flow.trigger_config as KeywordTriggerConfig,
      )) {
        return flow;
      }
    } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound) {
      return flow;
    }
    // 'manual' triggers do not auto-start from inbound messages.
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  ownerUserId: string,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    userId: ownerUserId,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  ownerUserId: string,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    userId: ownerUserId,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from("conversations")
      .update(convUpdate)
      .eq("id", run.conversation_id);
  }
  await logEvent(db, run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await db
      .from("contact_tags")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", run.contact_id!)
      .eq("tag_id", cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from("contacts")
      .select(cfg.subject_key)
      .eq("id", run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
/**
 * Auto-resuelve el input para shopify_lookup cuando el merchant no
 * setea input_var en el card. El card de la UI lo oculta para reducir
 * fricción; el engine cubre el caso común:
 *   - Si input_var está seteado y tiene valor en vars, lo usa.
 *   - Si no, busca el último valor "razonable" en vars (heurística por
 *     kind):
 *       order_by_number → busca vars con keys que contengan "numero",
 *         "pedido", "order"; cae al último valor string que parezca
 *         número.
 *       order_by_email  → busca vars con "email" o "correo"; el contact
 *         por email lo hace runShopifyLookup directamente, esto es para
 *         cuando el merchant pasa el email vía vars.
 *       product_by_handle → vars con "handle".
 *       last_order      → no necesita input (usa email/phone del
 *         contacto via runShopifyLookup).
 *
 * Si no encuentra nada, devuelve "" y runShopifyLookup retorna found
 * false (rama no_encontrado).
 */
function resolveShopifyInput(
  kind: string,
  explicitVar: string | undefined,
  vars: Record<string, unknown>,
): string {
  if (explicitVar) {
    const v = vars[explicitVar];
    if (v != null) return String(v);
  }
  if (kind === "last_order") return ""; // no input needed
  const keywords: Record<string, string[]> = {
    order_by_number: ["numero", "número", "pedido", "order", "orden", "id"],
    order_by_email: ["email", "correo", "mail"],
    product_by_handle: ["handle", "producto", "product"],
  };
  const wanted = keywords[kind] ?? [];
  // Prefer keys que contengan los keywords del kind.
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue;
    const lower = k.toLowerCase();
    if (wanted.some((w) => lower.includes(w))) {
      return String(v);
    }
  }
  // Fallback: para order_by_number, devuelve el último valor que
  // parezca un número (heurística). Para email, busca string con @.
  if (kind === "order_by_number") {
    let best: string | null = null;
    for (const [, v] of Object.entries(vars)) {
      if (v == null) continue;
      const s = String(v);
      if (/^\s*#?\d{3,}\s*$/.test(s)) best = s;
    }
    if (best) return best;
  }
  if (kind === "order_by_email") {
    let best: string | null = null;
    for (const [, v] of Object.entries(vars)) {
      if (v == null) continue;
      const s = String(v);
      if (s.includes("@")) best = s;
    }
    if (best) return best;
  }
  return "";
}

function resolveDottedPath(
  root: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(
    /\{\{vars\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\}\}/g,
    (_, path) => {
      const v = resolveDottedPath(vars, path);
      return v === undefined || v === null ? "" : String(v);
    },
  );
}

/**
 * Backoff de reintentos para sends interactivos (botones/lista) que
 * fallan de forma transitoria. El cron de retries usa el mismo orden.
 * Después del 5to intento (índice 4) el cron termina el run con
 * 'failed'.
 */
const RETRY_DELAYS_MS = [
  60_000,        // 1 min
  5 * 60_000,    // 5 min
  30 * 60_000,   // 30 min
  2 * 3_600_000, // 2 h
  6 * 3_600_000, // 6 h
] as const;

export function nextRetryDelayMs(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[i];
}

export const MAX_SEND_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;

async function scheduleSendRetry(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  retryKind: "send_buttons" | "send_list",
  error: unknown,
): Promise<void> {
  const runAt = new Date(Date.now() + RETRY_DELAYS_MS[0]).toISOString();
  await db.from("flow_pending_retries").insert({
    flow_run_id: run.id,
    workspace_id: run.workspace_id,
    node_key: node.node_key,
    attempt: 0,
    max_attempts: MAX_SEND_RETRY_ATTEMPTS,
    run_at: runAt,
    retry_kind: retryKind,
    last_error: error instanceof Error ? error.message : String(error),
  });
  await db
    .from("flow_runs")
    .update({ status: "paused_for_retry" })
    .eq("id", run.id);
  await logEvent(db, run.id, "error", node.node_key, {
    reason: `${retryKind}_send_failed_scheduled_retry`,
    detail: error instanceof Error ? error.message : String(error),
    run_at: runAt,
  });
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await db
    .from("flow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", runId);
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  // The meta-send helpers look up `contacts.user_id` /
  // `whatsapp_config.user_id` — the legacy auth.users.id columns, not
  // the workspace id. Passing `run.workspace_id` into those queries
  // silently returned `null` and every send failed with "contact not
  // found for this user". Resolve once and reuse for every node.
  const ownerUserId = await resolveWorkspaceOwnerUserId(db, run.workspace_id);
  if (!ownerUserId) {
    await logEvent(db, run.id, "error", null, {
      reason: "workspace_owner_not_found",
      workspace_id: run.workspace_id,
    });
    await endRun(db, run.id, "failed", "workspace_owner_not_found");
    return { outcome: "completed" };
  }
  let currentKey: string | null = startNodeKey;
  // Mutable: cuando entramos a un subflujo, swappeamos esto por los
  // nodos del flujo referenciado. Cuando salimos (end/handoff con
  // call_stack no vacía), restauramos el del padre.
  let currentNodes: Map<string, FlowNodeRow> = nodes;
  // Espejo en memoria de run.call_stack. Lo persistimos antes de
  // cualquier suspend (collect_input, send_buttons, etc.) y antes de
  // cualquier return temprano para que un resume futuro vuelva al
  // subflujo correcto. Frames: {flow_id, return_to_node_key}.
  const activeCallStack: FlowRunCallFrame[] = Array.isArray(run.call_stack)
    ? [...run.call_stack]
    : [];
  // Profundidad máxima de subflujos. Más que esto y es casi seguro un
  // bug del merchant (ciclo entre dos subflujos que se llaman entre sí).
  const MAX_SUBFLOW_DEPTH = 5;

  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: FlowNodeRow | null = currentNodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(db, run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          userId: ownerUserId,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          userId: ownerUserId,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const { data: msg } = await db
          .from("messages")
          .select("id")
          .eq("message_id", whatsapp_message_id)
          .maybeSingle();
        await db
          .from("flow_runs")
          .update({
            last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
          })
          .eq("id", run.id);
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "customer_reply") {
      // No envía nada — solo suspende. Marca el run como "esperando
      // en este nodo" y vuelve. El próximo mensaje inbound del cliente
      // dispara handleReplyForActiveRun → advance al next_node_key.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "customer_reply",
      });
      return { outcome: "advanced" };
    }
    if (node.node_type === "subflow") {
      // v2 runtime real: empujamos un frame al call_stack, swappeamos
      // los nodos en memoria por los del subflujo, y seteamos
      // currentKey al entry del subflujo. Cuando el subflujo termine
      // (end o handoff) hacemos pop y continuamos en next_node_key
      // del nodo subflow actual.
      const cfg = node.config as unknown as {
        sub_flow_id?: string;
        next_node_key?: string;
      };
      if (!cfg.sub_flow_id || !cfg.next_node_key) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "subflow_misconfigured",
          sub_flow_id: cfg.sub_flow_id ?? null,
        });
        await endRun(db, run.id, "failed", "subflow_misconfigured");
        return { outcome: "completed" };
      }
      if (activeCallStack.length >= MAX_SUBFLOW_DEPTH) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "subflow_max_depth",
          depth: activeCallStack.length,
        });
        await endRun(db, run.id, "failed", "subflow_max_depth");
        return { outcome: "completed" };
      }
      const subFlow = await loadFlow(db, cfg.sub_flow_id);
      if (!subFlow || subFlow.status !== "active") {
        // Si el flujo referenciado no existe o no está activo, log y
        // saltar al next_node_key (pasarela suave en vez de fallar).
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "subflow_not_active",
          sub_flow_id: cfg.sub_flow_id,
        });
        currentKey = cfg.next_node_key;
        continue;
      }
      if (!subFlow.entry_node_id) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "subflow_no_entry",
          sub_flow_id: cfg.sub_flow_id,
        });
        currentKey = cfg.next_node_key;
        continue;
      }
      activeCallStack.push({
        flow_id: cfg.sub_flow_id,
        return_to_node_key: cfg.next_node_key,
      });
      currentNodes = await loadAllNodes(db, cfg.sub_flow_id);
      currentKey = subFlow.entry_node_id;
      // Persistir el call_stack al toque para que un crash o un
      // resume futuro respete el estado.
      await db
        .from("flow_runs")
        .update({ call_stack: activeCallStack })
        .eq("id", run.id);
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "subflow",
        sub_flow_id: cfg.sub_flow_id,
        depth: activeCallStack.length,
      });
      continue;
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(db, run, cfg))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await db
            .from("contact_tags")
            .upsert(
              { contact_id: run.contact_id!, tag_id: cfg.tag_id },
              { onConflict: "contact_id,tag_id" },
            );
        } else {
          await db
            .from("contact_tags")
            .delete()
            .eq("contact_id", run.contact_id!)
            .eq("tag_id", cfg.tag_id);
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      try {
        await sendButtonsAndSuspend(db, run, node, ownerUserId);
      } catch (err) {
        await scheduleSendRetry(db, run, node, "send_buttons", err);
        return { outcome: "advanced" };
      }
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      try {
        await sendListAndSuspend(db, run, node, ownerUserId);
      } catch (err) {
        await scheduleSendRetry(db, run, node, "send_list", err);
        return { outcome: "advanced" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      // handoff dentro de un subflujo: el handoff es una decisión
      // fuerte del flujo padre o del subflujo — siempre cierra el
      // run completo, no solo el subflujo. (Si el merchant quiere
      // que el subflujo "vuelva al padre" usa un nodo end, no
      // handoff.)
      await executeHandoff(db, run, node);
      return { outcome: "handed_off" };
    }
    if (
      node.node_type === "send_image" ||
      node.node_type === "send_video" ||
      node.node_type === "send_document"
    ) {
      const cfg = node.config as unknown as
        | SendImageNodeConfig
        | SendVideoNodeConfig
        | SendDocumentNodeConfig;
      try {
        const sender =
          node.node_type === "send_image"
            ? engineSendImage
            : node.node_type === "send_video"
              ? engineSendVideo
              : engineSendDocument;
        const { whatsapp_message_id } = await sender({
          userId: ownerUserId,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          url: interpolateVars(cfg.url, run.vars),
          caption: cfg.caption ? interpolateVars(cfg.caption, run.vars) : undefined,
          filename:
            node.node_type === "send_document"
              ? (cfg as SendDocumentNodeConfig).filename
              : undefined,
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: node.node_type,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: `${node.node_type}_failed`,
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", `${node.node_type}_failed`);
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_cta_url") {
      const cfg = node.config as unknown as SendCtaUrlNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendCtaUrl({
          userId: ownerUserId,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          bodyText: interpolateVars(cfg.text, run.vars),
          buttonTitle: cfg.button_title,
          url: interpolateVars(cfg.url, run.vars),
          headerText: cfg.header_text
            ? interpolateVars(cfg.header_text, run.vars)
            : undefined,
          footerText: cfg.footer_text
            ? interpolateVars(cfg.footer_text, run.vars)
            : undefined,
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_cta_url",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_cta_url_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_cta_url_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "wait") {
      const cfg = node.config as unknown as WaitNodeConfig;
      const unitMs =
        cfg.unit === "days"
          ? 86_400_000
          : cfg.unit === "hours"
            ? 3_600_000
            : 60_000;
      const runAt = new Date(Date.now() + Math.max(1, cfg.amount) * unitMs);
      await db.from("flow_pending_executions").insert({
        flow_run_id: run.id,
        next_node_key: cfg.next_node_key,
        run_at: runAt.toISOString(),
      });
      await logEvent(db, run.id, "node_entered", node.node_key, {
        node_type: "wait",
        resume_at: runAt.toISOString(),
      });
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "ai_intent") {
      const cfg = node.config as unknown as AiIntentNodeConfig;
      try {
        if (cfg.prompt_text && cfg.prompt_text.trim()) {
          const { whatsapp_message_id } = await engineSendText({
            userId: ownerUserId,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: interpolateVars(cfg.prompt_text, run.vars),
          });
          await logEvent(db, run.id, "message_sent", node.node_key, {
            node_type: "ai_intent",
            whatsapp_message_id,
          });
        }
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "ai_intent_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "ai_intent_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "shopify_lookup") {
      const cfg = node.config as unknown as ShopifyLookupNodeConfig;
      try {
        // input_var es opcional: si no está, auto-resolvemos según
        // el kind y el último dato capturado por collect_input. Esto
        // alivia al merchant de tener que setear input_var en el card
        // (la UI lo oculta a propósito).
        const input = resolveShopifyInput(cfg.kind, cfg.input_var, run.vars);
        // output_prefix también opcional: si está vacío, default por kind.
        const outputPrefix =
          (cfg.output_prefix && cfg.output_prefix.trim()) ||
          (cfg.kind === "product_by_handle" ? "product" : "order");
        const result = await runShopifyLookup({
          userId: ownerUserId,
          workspaceId: run.workspace_id,
          contactId: run.contact_id!,
          kind: cfg.kind,
          input,
        });
        if (result.found && result.vars) {
          const merged = { ...run.vars };
          for (const [k, v] of Object.entries(result.vars)) {
            merged[`${outputPrefix}_${k}`] = v;
          }
          await db.from("flow_runs").update({ vars: merged }).eq("id", run.id);
          run.vars = merged;
        }
        await logEvent(db, run.id, "node_entered", node.node_key, {
          node_type: "shopify_lookup",
          found: result.found,
        });
        currentKey = result.found
          ? cfg.found_next_key
          : cfg.not_found_next_key;
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "shopify_lookup_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        currentKey = cfg.not_found_next_key;
      }
      continue;
    }
    if (node.node_type === "end") {
      // Si el end está DENTRO de un subflujo (activeCallStack no
      // vacía), no terminamos el run — hacemos pop del frame,
      // cargamos los nodos del padre, y continuamos en el
      // return_to_node_key del frame. Si no hay frames, el end
      // sí cierra el run.
      if (activeCallStack.length > 0) {
        const popped = activeCallStack.pop()!;
        // Cargar los nodos del flujo padre: si quedan más frames es
        // el flujo del nuevo top; si no, es el flujo raíz del run.
        const parentFlowId =
          activeCallStack.length > 0
            ? activeCallStack[activeCallStack.length - 1].flow_id
            : run.flow_id;
        currentNodes = await loadAllNodes(db, parentFlowId);
        currentKey = popped.return_to_node_key;
        await db
          .from("flow_runs")
          .update({ call_stack: activeCallStack })
          .eq("id", run.id);
        await logEvent(db, run.id, "node_entered", node.node_key, {
          node_type: "end",
          returned_from_subflow: popped.flow_id,
          remaining_depth: activeCallStack.length,
        });
        continue;
      }
      await logEvent(db, run.id, "completed", node.node_key);
      await endRun(db, run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(db, run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  // PostgREST: when expectedOldKey is null we can't `.eq` (would match
  // any row); use `.is('current_node_key', null)` instead.
  let q = db
    .from("flow_runs")
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active");
  if (expectedOldKey === null) {
    q = q.is("current_node_key", null);
  } else {
    q = q.eq("current_node_key", expectedOldKey);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[flows] advanceCurrentNodeKey error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.userId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.userId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes. Si el run está pausado DENTRO de
      // un subflujo (call_stack no vacía), cargamos los nodos del
      // subflujo activo, no del flujo raíz.
      const activeFlowId = getActiveFlowIdForRun(activeRun);
      const nodes = await loadAllNodes(db, activeFlowId);
      return handleReplyForActiveRun(db, activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.userId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(db, flow.id);
    return startNewRun(db, flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  // Same reason as in advanceFromNodeKey: meta-send helpers scope by
  // `contacts.user_id` (auth.users.id), not workspace_id.
  const ownerUserId = await resolveWorkspaceOwnerUserId(db, run.workspace_id);
  if (!ownerUserId) {
    await logEvent(db, run.id, "error", run.current_node_key, {
      reason: "workspace_owner_not_found",
      workspace_id: run.workspace_id,
    });
    await endRun(db, run.id, "failed", "workspace_owner_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(db, run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length === 0) {
      // Cliente envió un mensaje vacío (solo espacios). No avanza —
      // re-enviamos el prompt para que vuelva a intentar.
      try {
        await engineSendText({
          userId: ownerUserId,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, "error", currentNode.node_key, {
          reason: "collect_input_empty_reprompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      await logEvent(db, run.id, "fallback_fired", currentNode.node_key, {
        action: "reprompt",
        reason: "empty_input",
      });
      return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
    }
    if (cfg.var_key) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      const { error: capErr } = await db
        .from("flow_runs")
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq("id", run.id);
      if (!capErr) {
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      }
    }
  } else if (currentNode.node_type === "customer_reply") {
    // Cualquier mensaje (text / interactive / media) consume el wait.
    // No capturamos nada — solo avanzamos a next_node_key.
    const cfg = currentNode.config as unknown as {
      next_node_key?: string;
    };
    if (cfg.next_node_key) {
      await logEvent(db, run.id, "node_entered", currentNode.node_key, {
        node_type: "customer_reply",
        advancing_to: cfg.next_node_key,
      });
      matched = cfg.next_node_key;
    } else {
      // customer_reply sin destino — dead-end. La validación pre-activación
      // lo bloquea, pero un draft activado a fuerza o un patch de la IA
      // podría dejar uno sin wire. En vez de caer al fallback de reprompt
      // (que para customer_reply sería un loop infinito porque NO hay
      // prompt que re-enviar), terminamos el run limpiamente.
      await logEvent(db, run.id, "error", currentNode.node_key, {
        reason: "customer_reply_dead_end",
      });
      await endRun(db, run.id, "failed", "customer_reply_dead_end");
      return { consumed: true, flow_run_id: run.id, outcome: "completed" };
    }
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "ai_intent"
  ) {
    // Classify the reply through the workspace AI agent and route on
    // the returned intent_key. Falls back to fallback_next_key when
    // no intent matches with confidence.
    const cfg = currentNode.config as unknown as AiIntentNodeConfig;
    try {
      const intentKey = await classifyIntent({
        workspaceId: run.workspace_id,
        message: message.text,
        intents: cfg.intents,
      });
      await logEvent(db, run.id, "node_entered", currentNode.node_key, {
        node_type: "ai_intent",
        matched_intent: intentKey ?? null,
      });
      matched =
        cfg.intents.find((i) => i.intent_key === intentKey)?.next_node_key ??
        cfg.fallback_next_key;
    } catch (err) {
      await logEvent(db, run.id, "error", currentNode.node_key, {
        reason: "ai_intent_classify_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      matched = cfg.fallback_next_key;
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from("flow_runs")
        .update({ reprompt_count: 0 })
        .eq("id", run.id);
      if (!error) run.reprompt_count = 0;
    }
    const outcome = await advanceFromNodeKey(db, run, matched, nodes);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(db, run.flow_id))?.fallback_policy,
  );
  const newReprompts = run.reprompt_count + 1;
  await db
    .from("flow_runs")
    .update({ reprompt_count: newReprompts })
    .eq("id", run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      try {
        await sendButtonsAndSuspend(db, run, currentNode, ownerUserId);
      } catch (err) {
        await scheduleSendRetry(db, run, currentNode, "send_buttons", err);
        return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
      }
    } else if (currentNode.node_type === "send_list") {
      try {
        await sendListAndSuspend(db, run, currentNode, ownerUserId);
      } catch (err) {
        await scheduleSendRetry(db, run, currentNode, "send_list", err);
        return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
      }
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          userId: ownerUserId,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await db
        .from("conversations")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", run.conversation_id);
    }
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(db, run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(db, run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  const { data: inserted, error: insErr } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      workspace_id: flow.workspace_id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: "active",
      current_node_key: flow.entry_node_id,
    })
    .select("*")
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → another webhook is starting the run.
    const msg = insErr.message ?? "";
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", insErr.message);
    return { consumed: false, outcome: "no_match" };
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, "started", flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
    meta_message_id: input.message.meta_message_id,
  });
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count rpc error:", incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(db, run, flow.entry_node_id!, nodes);
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}

// ------------------------------------------------------------
// Resume bridge — used by the cron at /api/cron/flows-resume.
// Kept separate from dispatchInboundToFlows because the cron has
// no inbound message; it just needs to walk the engine forward
// from the parked node.
// ------------------------------------------------------------
export const __advanceFromNodeKeyForResume = advanceFromNodeKey

// ------------------------------------------------------------
// Retry bridge — usado por /api/flows/retries/cron para reintentar
// sends interactivos fallidos. Devuelve true si el send funcionó (y
// el run quedó activo de nuevo) o false si falló (el cron reagenda).
// ------------------------------------------------------------
export async function retrySendNode(args: {
  run: FlowRunRow;
  node: FlowNodeRow;
  retryKind: "send_buttons" | "send_list";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = supabaseAdmin();
  try {
    const ownerUserId = await resolveWorkspaceOwnerUserId(
      db,
      args.run.workspace_id,
    );
    if (!ownerUserId) {
      return { ok: false, error: "workspace_owner_not_found" };
    }
    if (args.retryKind === "send_buttons") {
      await sendButtonsAndSuspend(db, args.run, args.node, ownerUserId);
    } else {
      await sendListAndSuspend(db, args.run, args.node, ownerUserId);
    }
    // Restaurar el run a activo y avanzar current_node_key al nodo
    // que mandó (idéntico al path normal).
    await db
      .from("flow_runs")
      .update({
        status: "active",
        current_node_key: args.node.node_key,
        last_advanced_at: new Date().toISOString(),
      })
      .eq("id", args.run.id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function failRunFromRetry(
  flowRunId: string,
  reason: string,
): Promise<void> {
  await endRun(supabaseAdmin(), flowRunId, "failed", reason);
}

