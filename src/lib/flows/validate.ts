/**
 * Save-time validation for flows.
 *
 * Run before activation (not on every draft save) — drafts are
 * intentionally allowed to be incomplete so users can save progress
 * mid-build. The builder calls these from BOTH client (so the user
 * sees issues live) and server (so a broken POST/PUT can't slip in
 * via direct API call).
 *
 * Three rule categories:
 *   1. Trigger sanity — keyword flows need keywords, etc.
 *   2. Graph integrity — entry node exists, all next_node_key
 *      references resolve, no unreachable nodes, non-terminal nodes
 *      have an outgoing edge.
 *   3. Meta API limits — button title ≤20 chars, ≤3 buttons per
 *      send_buttons, ≤10 list rows total, ≤24 chars per list row
 *      title. Mirrors the runtime checks inside
 *      `src/lib/whatsapp/meta-api.ts` so save-time and send-time
 *      can never disagree.
 *
 * Issues carry enough field info that the builder can highlight the
 * exact input that triggered them. Node-scoped issues include
 * `node_key`; trigger-scoped use `scope: 'trigger'`.
 */

import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";

export interface ValidationIssue {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  /** Stable node_key the issue is attached to, when scope === 'node'. */
  node_key?: string;
  /** Dotted path to the bad field, e.g. 'buttons.0.title'. */
  field?: string;
  message: string;
}

interface FlowInput {
  name: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ---- name ----
  if (!flow.name || !flow.name.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "Falta el nombre del menú.",
    });
  }

  // ---- trigger ----
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));

  // ---- graph integrity ----
  if (!flow.entry_node_id) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: "Elegí dónde empieza el menú antes de activarlo.",
    });
  }

  const keys = new Set(nodes.map((n) => n.node_key));
  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "Añadí al menos un paso antes de activar.",
    });
  }

  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: `Entry node "${flow.entry_node_id}" doesn't exist.`,
    });
  }

  // Duplicate node_key (the DB UNIQUE constraint catches this on save
  // too, but surfacing it client-side gives a friendlier error path).
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.node_key)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: n.node_key,
        message: `Duplicate node_key "${n.node_key}".`,
      });
    }
    seen.add(n.node_key);
  }

  // Per-node rules (Meta limits + dead-end + edge resolution).
  for (const n of nodes) {
    issues.push(...validateNode(n, keys));
  }

  // Reachability — every non-orphan node must be reachable from the
  // entry. Done after per-node validation so we don't double-report
  // when a node has bad config AND is unreachable.
  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const n of nodes) {
      if (!reached.has(n.node_key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: n.node_key,
          message: `Node "${n.node_key}" is unreachable from the entry node.`,
        });
      }
    }
  }

  return issues;
}

// ============================================================
// Trigger
// ============================================================

function validateTrigger(
  trigger_type: FlowInput["trigger_type"],
  trigger_config: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (trigger_type === "keyword") {
    const keywords = Array.isArray(trigger_config.keywords)
      ? (trigger_config.keywords as unknown[])
      : null;
    if (!keywords || keywords.length === 0) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.keywords",
        message: "Tenés que escribir al menos una palabra clave.",
      });
    } else {
      // Empty / whitespace-only keywords are silent no-ops at match
      // time — call them out so the user doesn't think they configured
      // a keyword that never fires.
      const blanks = keywords.filter(
        (k) => typeof k !== "string" || !k.trim(),
      ).length;
      if (blanks > 0) {
        issues.push({
          severity: "warning",
          scope: "trigger",
          field: "trigger_config.keywords",
          message: `${blanks} keyword${blanks === 1 ? " is" : "s are"} blank — they won't match anything.`,
        });
      }
    }
  }
  // first_inbound_message / manual have no config; nothing to validate.

  return issues;
}

// ============================================================
// Per-node
// ============================================================

function validateNode(
  node: NodeInput,
  knownKeys: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  switch (node.node_type) {
    case "start": {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "El nodo de inicio tiene que apuntar a un siguiente paso.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Start points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_message": {
      const cfg = node.config as { text?: string; next_node_key?: string };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "Escribí el texto del mensaje.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Conectá este mensaje al siguiente paso.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Send-message points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_buttons": {
      const cfg = node.config as {
        text?: string;
        buttons?: Array<{
          reply_id?: string;
          title?: string;
          next_node_key?: string;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "Escribí el texto que acompaña los botones.",
        });
      }
      const btns = cfg.buttons ?? [];
      if (btns.length < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: "Añadí al menos un botón.",
        });
      }
      if (btns.length > INTERACTIVE_LIMITS.maxButtons) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: `WhatsApp allows at most ${INTERACTIVE_LIMITS.maxButtons} buttons per message.`,
        });
      }
      const seenIds = new Set<string>();
      btns.forEach((b, i) => {
        const field = `buttons.${i}`;
        if (!b.reply_id?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Button ${i + 1} needs a reply id.`,
          });
        } else if (seenIds.has(b.reply_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Duplicate button reply id "${b.reply_id}".`,
          });
        }
        if (b.reply_id) seenIds.add(b.reply_id);

        if (!b.title?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `Button ${i + 1} needs a title.`,
          });
        } else if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `Button ${i + 1} title is over ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars (WhatsApp limit).`,
          });
        }

        if (!b.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `Button ${i + 1} needs a next node.`,
          });
        } else if (!knownKeys.has(b.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `Button ${i + 1} points to non-existent node "${b.next_node_key}".`,
          });
        }
      });
      break;
    }

    case "send_list": {
      const cfg = node.config as {
        text?: string;
        button_label?: string;
        sections?: Array<{
          title?: string;
          rows?: Array<{
            reply_id?: string;
            title?: string;
            description?: string;
            next_node_key?: string;
          }>;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "Escribí el texto que acompaña la lista.",
        });
      }
      if (!cfg.button_label?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "button_label",
          message: "Escribí el texto del botón que abre la lista.",
        });
      }
      const sections = cfg.sections ?? [];
      const totalRows = sections.reduce(
        (sum, s) => sum + (s.rows?.length ?? 0),
        0,
      );
      if (totalRows < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: "Añadí al menos una opción a la lista.",
        });
      }
      if (totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: `Send-list allows at most ${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across sections.`,
        });
      }
      const seenIds = new Set<string>();
      sections.forEach((section, si) => {
        const rows = section.rows ?? [];
        rows.forEach((row, ri) => {
          const field = `sections.${si}.rows.${ri}`;
          if (!row.reply_id?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Row ${ri + 1} in section ${si + 1} needs a reply id.`,
            });
          } else if (seenIds.has(row.reply_id)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Duplicate list row id "${row.reply_id}".`,
            });
          }
          if (row.reply_id) seenIds.add(row.reply_id);

          if (!row.title?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `Row ${ri + 1} needs a title.`,
            });
          } else if (
            row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `Row ${ri + 1} title exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`,
            });
          }
          if (
            row.description &&
            row.description.length >
              INTERACTIVE_LIMITS.listRowDescriptionMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.description`,
              message: `Row ${ri + 1} description exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`,
            });
          }
          if (!row.next_node_key) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `Row ${ri + 1} needs a next node.`,
            });
          } else if (!knownKeys.has(row.next_node_key)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `Row ${ri + 1} points to non-existent node "${row.next_node_key}".`,
            });
          }
        });
      });
      break;
    }

    case "collect_input": {
      const cfg = node.config as {
        prompt_text?: string;
        var_key?: string;
        next_node_key?: string;
      };
      if (!cfg.prompt_text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "prompt_text",
          message: "Escribí la pregunta que se le hace al cliente.",
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: "Ponle un nombre a la variable donde se guarda la respuesta.",
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: `var_key "${cfg.var_key}" must be alphanumeric+underscore and start with a letter or underscore.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Conectá este paso al siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Collect-input points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "condition": {
      const cfg = node.config as {
        subject?: "var" | "tag" | "contact_field";
        subject_key?: string;
        operator?: "equals" | "contains" | "present" | "absent";
        value?: string;
        true_next?: string;
        false_next?: string;
      };
      if (!cfg.subject || !["var", "tag", "contact_field"].includes(cfg.subject)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject",
          message: "Elegí qué evaluar (variable, etiqueta o campo).",
        });
      }
      if (!cfg.subject_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject_key",
          message: "Indicá qué variable, etiqueta o campo evaluar.",
        });
      }
      if (
        !cfg.operator ||
        !["equals", "contains", "present", "absent"].includes(cfg.operator)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "operator",
          message: "Elegí cómo comparar.",
        });
      } else if (
        (cfg.operator === "equals" || cfg.operator === "contains") &&
        (cfg.value === undefined || cfg.value === "")
      ) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: node.node_key,
          field: "value",
          message: `Operator "${cfg.operator}" usually expects a comparison value — empty value will only match empty subjects.`,
        });
      }
      for (const branch of ["true_next", "false_next"] as const) {
        const key = cfg[branch];
        if (!key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `Condition needs a node for the "${branch === "true_next" ? "true" : "false"}" branch.`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `Condition's "${branch}" points to non-existent node "${key}".`,
          });
        }
      }
      break;
    }

    case "set_tag": {
      const cfg = node.config as {
        mode?: "add" | "remove";
        tag_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !["add", "remove"].includes(cfg.mode)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "mode",
          message: "Elegí si la etiqueta se añade o se quita.",
        });
      }
      if (!cfg.tag_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "tag_id",
          message: "Elegí la etiqueta.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Conectá este paso al siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Set-tag points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_image":
    case "send_video":
    case "send_document": {
      const cfg = node.config as {
        url?: string;
        next_node_key?: string;
      };
      if (!cfg.url || !/^https?:\/\//.test(cfg.url)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: `${node.node_type} requires a https URL.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: `${node.node_type} needs a next_node_key.`,
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: `${node.node_type} points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }
    case "send_cta_url": {
      const cfg = node.config as {
        text?: string;
        button_title?: string;
        url?: string;
        next_node_key?: string;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "Escribí el texto del mensaje.",
        });
      }
      if (!cfg.button_title?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "Ponle texto al botón.",
        });
      }
      if (!cfg.url || !/^https:\/\//.test(cfg.url)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "La URL tiene que empezar con https://.",
        });
      }
      if (cfg.next_node_key && !knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: `send_cta_url points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }
    case "wait": {
      const cfg = node.config as {
        amount?: number;
        unit?: string;
        next_node_key?: string;
      };
      if (!cfg.amount || cfg.amount < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "La cantidad de espera tiene que ser al menos 1.",
        });
      }
      if (!cfg.unit || !["minutes", "hours", "days"].includes(cfg.unit)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "Elegí minutos, horas o días.",
        });
      }
      if (cfg.next_node_key && !knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: `wait points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }
    case "ai_intent": {
      const cfg = node.config as {
        intents?: Array<{ intent_key?: string; next_node_key?: string }>;
        fallback_next_key?: string;
      };
      if (!cfg.intents || cfg.intents.length === 0) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "Añadí al menos una intención.",
        });
      }
      for (const i of cfg.intents ?? []) {
        if (!i.intent_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            message: "Cada intención necesita un nombre.",
          });
        }
        if (i.next_node_key && !knownKeys.has(i.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            message: `ai_intent intent points to non-existent node "${i.next_node_key}".`,
          });
        }
      }
      if (cfg.fallback_next_key && !knownKeys.has(cfg.fallback_next_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: `ai_intent fallback points to non-existent node "${cfg.fallback_next_key}".`,
        });
      }
      break;
    }
    case "shopify_lookup": {
      const cfg = node.config as {
        kind?: string;
        output_prefix?: string;
        found_next_key?: string;
        not_found_next_key?: string;
      };
      const VALID_KINDS = [
        "order_by_number",
        "order_by_email",
        "last_order",
        "product_by_handle",
      ];
      if (!cfg.kind || !VALID_KINDS.includes(cfg.kind)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "Elegí qué buscar en Shopify.",
        });
      }
      if (!cfg.output_prefix) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          message: "Ponle un nombre al resultado (ej: pedido).",
        });
      }
      for (const k of [cfg.found_next_key, cfg.not_found_next_key]) {
        if (k && !knownKeys.has(k)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            message: `shopify_lookup points to non-existent node "${k}".`,
          });
        }
      }
      break;
    }

    case "handoff":
    case "end":
      // Terminal nodes have no outgoing edges; nothing to validate
      // beyond their existence.
      break;

    default:
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Unknown node type "${node.node_type}".`,
      });
  }

  return issues;
}

// ============================================================
// Reachability — BFS from the entry, follow outgoing edges per node
// ============================================================

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[],
): Set<string> {
  const byKey = new Map<string, NodeInput>();
  for (const n of nodes) byKey.set(n.node_key, n);

  const visited = new Set<string>();
  const queue: string[] = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    for (const next of outgoingEdges(node)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function outgoingEdges(node: NodeInput): string[] {
  switch (node.node_type) {
    case "start":
    case "send_message":
    case "send_image":
    case "send_video":
    case "send_document":
    case "send_cta_url":
    case "collect_input":
    case "set_tag":
    case "wait": {
      const cfg = node.config as { next_node_key?: string };
      return cfg.next_node_key ? [cfg.next_node_key] : [];
    }
    case "shopify_lookup": {
      const cfg = node.config as {
        found_next_key?: string;
        not_found_next_key?: string;
      };
      const out: string[] = [];
      if (cfg.found_next_key) out.push(cfg.found_next_key);
      if (cfg.not_found_next_key) out.push(cfg.not_found_next_key);
      return out;
    }
    case "ai_intent": {
      const cfg = node.config as {
        intents?: Array<{ next_node_key?: string }>;
        fallback_next_key?: string;
      };
      const out: string[] = [];
      for (const i of cfg.intents ?? []) {
        if (i.next_node_key) out.push(i.next_node_key);
      }
      if (cfg.fallback_next_key) out.push(cfg.fallback_next_key);
      return out;
    }
    case "condition": {
      const cfg = node.config as {
        true_next?: string;
        false_next?: string;
      };
      const out: string[] = [];
      if (cfg.true_next) out.push(cfg.true_next);
      if (cfg.false_next) out.push(cfg.false_next);
      return out;
    }
    case "send_buttons": {
      const cfg = node.config as {
        buttons?: Array<{ next_node_key?: string }>;
      };
      return (cfg.buttons ?? [])
        .map((b) => b.next_node_key)
        .filter((k): k is string => !!k);
    }
    case "send_list": {
      const cfg = node.config as {
        sections?: Array<{ rows?: Array<{ next_node_key?: string }> }>;
      };
      const out: string[] = [];
      for (const s of cfg.sections ?? []) {
        for (const r of s.rows ?? []) {
          if (r.next_node_key) out.push(r.next_node_key);
        }
      }
      return out;
    }
    case "handoff":
    case "end":
    default:
      return [];
  }
}
