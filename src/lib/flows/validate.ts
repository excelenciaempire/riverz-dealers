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

/** Capitaliza la primera letra. Para encajar fragmentos como `el botón "X"`
 *  al principio de una frase ("El botón ..."). */
function capFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

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
      message: "Elige dónde empieza el menú antes de activarlo.",
    });
  }

  const keys = new Set(nodes.map((n) => n.node_key));
  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "Añade al menos un paso antes de activar.",
    });
  }

  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message:
        "El paso por el que empieza el menú ya no existe. Elige otro paso para empezar.",
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
        message:
          "Hay dos pasos con el mismo nombre interno. Borra uno o cambia el nombre.",
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
          message:
            "Este paso queda suelto: no se llega desde el inicio. Conéctalo a algún paso anterior o bórralo.",
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
        message:
          "Escribe al menos una palabra clave que dispare el menú (ej: \"menú\", \"hola\").",
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
          message:
            blanks === 1
              ? "Hay una palabra clave vacía. No va a disparar el menú — bórrala o escríbele algo."
              : `Hay ${blanks} palabras clave vacías. No van a disparar el menú — bórralas o escríbeles algo.`,
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
          message:
            "El paso de inicio no está conectado a nada. Conéctalo al primer paso real del menú.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "El paso de inicio apunta a un paso que ya no existe. Vuélvelo a conectar.",
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
          message: "Escribe el texto del mensaje que se le va a enviar al cliente.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este mensaje no está conectado al siguiente paso. Arrastra desde el círculo de la derecha hasta el próximo paso.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este mensaje apunta a un paso que ya no existe. Vuélvelo a conectar.",
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
          message: "Escribe el texto que va arriba de los botones.",
        });
      }
      const btns = cfg.buttons ?? [];
      if (btns.length < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: "Agrega al menos un botón.",
        });
      }
      if (btns.length > INTERACTIVE_LIMITS.maxButtons) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: `WhatsApp solo permite ${INTERACTIVE_LIMITS.maxButtons} botones por mensaje. Quita los que sobran o pasa a una lista (Enviar lista) si necesitas más opciones.`,
        });
      }
      const seenIds = new Set<string>();
      const btnLabel = (b: { title?: string }, i: number) =>
        b.title?.trim() ? `el botón "${b.title.trim()}"` : `el botón ${i + 1}`;
      btns.forEach((b, i) => {
        const field = `buttons.${i}`;
        if (!b.reply_id?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `${capFirst(btnLabel(b, i))} no tiene identificador interno. Escribe uno corto (ej: "comprar", "soporte").`,
          });
        } else if (seenIds.has(b.reply_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Hay otro botón con el mismo identificador "${b.reply_id}". Cámbiale el identificador a uno de los dos.`,
          });
        }
        if (b.reply_id) seenIds.add(b.reply_id);

        if (!b.title?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `El botón ${i + 1} no tiene texto. Escribe lo que va a ver el cliente.`,
          });
        } else if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `El texto de ${btnLabel(b, i)} es muy largo. WhatsApp solo permite ${INTERACTIVE_LIMITS.buttonTitleMaxLength} caracteres.`,
          });
        }

        if (!b.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `${capFirst(btnLabel(b, i))} no está conectado a ningún paso. Arrastra desde el círculo del botón hasta el próximo paso.`,
          });
        } else if (!knownKeys.has(b.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `${capFirst(btnLabel(b, i))} apunta a un paso que ya no existe. Vuélvelo a conectar.`,
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
          message: "Escribe el texto que se le muestra al cliente arriba de la lista.",
        });
      }
      if (!cfg.button_label?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "button_label",
          message:
            "Escribe el texto del botón que abre la lista (ej: \"Ver opciones\").",
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
          message: "Agrega al menos una opción a la lista.",
        });
      }
      if (totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: `La lista tiene más de ${INTERACTIVE_LIMITS.maxListRowsTotal} opciones. WhatsApp solo permite hasta ${INTERACTIVE_LIMITS.maxListRowsTotal} en total — quita las que sobran.`,
        });
      }
      const seenIds = new Set<string>();
      const rowLabel = (row: { title?: string }, ri: number) =>
        row.title?.trim()
          ? `la opción "${row.title.trim()}"`
          : `la opción ${ri + 1}`;
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
              message: `${capFirst(rowLabel(row, ri))} no tiene identificador interno. Escribe uno corto (ej: "comprar", "soporte").`,
            });
          } else if (seenIds.has(row.reply_id)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Hay otra opción con el mismo identificador "${row.reply_id}". Cámbiale el identificador a una de las dos.`,
            });
          }
          if (row.reply_id) seenIds.add(row.reply_id);

          if (!row.title?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `La opción ${ri + 1} no tiene texto. Escribe lo que va a ver el cliente.`,
            });
          } else if (
            row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `El texto de ${rowLabel(row, ri)} es muy largo. WhatsApp solo permite ${INTERACTIVE_LIMITS.listRowTitleMaxLength} caracteres.`,
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
              message: `La descripción de ${rowLabel(row, ri)} es muy larga. WhatsApp solo permite ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} caracteres.`,
            });
          }
          if (!row.next_node_key) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `${capFirst(rowLabel(row, ri))} no está conectada a ningún paso. Arrastra desde el círculo de la opción hasta el próximo paso.`,
            });
          } else if (!knownKeys.has(row.next_node_key)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `${capFirst(rowLabel(row, ri))} apunta a un paso que ya no existe. Vuélvela a conectar.`,
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
          message: "Escribe la pregunta que se le hace al cliente.",
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message:
            "Ponle un nombre a la variable donde se guarda la respuesta del cliente (ej: nombre, ciudad).",
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: `El nombre de la variable "${cfg.var_key}" solo puede tener letras, números y guion bajo, y debe empezar con letra. Ej: nombre, telefono, codigo_pedido.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Conecta este paso al siguiente. Arrastra desde el círculo de la derecha.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este paso apunta a otro que ya no existe. Vuélvelo a conectar.",
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
          message: "Elige qué quieres comparar: una variable, una etiqueta o un campo del contacto.",
        });
      }
      if (!cfg.subject_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject_key",
          message:
            "Falta el nombre exacto de la variable, etiqueta o campo que vas a comparar.",
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
          message: "Elige cómo comparar (igual a, contiene, existe, no existe).",
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
          message: `Estás comparando con "${cfg.operator === "equals" ? "igual a" : "contiene"}" pero no escribiste con qué. Si lo dejas vacío, solo va a coincidir cuando el valor también esté vacío.`,
        });
      }
      for (const branch of ["true_next", "false_next"] as const) {
        const key = cfg[branch];
        const branchName = branch === "true_next" ? "Sí" : "No";
        if (!key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `La rama "${branchName}" no está conectada a ningún paso. Arrastra desde el círculo de esa rama hasta el próximo paso.`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `La rama "${branchName}" apunta a un paso que ya no existe. Vuélvela a conectar.`,
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
          message: "Elige si la etiqueta se agrega o se quita al contacto.",
        });
      }
      if (!cfg.tag_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "tag_id",
          message: "Elige qué etiqueta agregar o quitar.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Conecta este paso al siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este paso apunta a otro que ya no existe. Vuélvelo a conectar.",
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
      const mediaName =
        node.node_type === "send_image"
          ? "la imagen"
          : node.node_type === "send_video"
            ? "el video"
            : "el documento";
      if (!cfg.url || !/^https?:\/\//.test(cfg.url)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "url",
          message: `Pega la URL pública de ${mediaName}. Tiene que empezar con http:// o https://.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Conecta este paso al siguiente.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este paso apunta a otro que ya no existe. Vuélvelo a conectar.",
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
          field: "text",
          message: "Escribe el texto del mensaje que va con el botón.",
        });
      }
      if (!cfg.button_title?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "button_title",
          message: "Escribe el texto del botón (ej: \"Ver oferta\").",
        });
      }
      if (!cfg.url || !/^https:\/\//.test(cfg.url)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "url",
          message:
            "La URL del botón tiene que empezar con https:// (WhatsApp no acepta http).",
        });
      }
      if (cfg.next_node_key && !knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este paso apunta a otro que ya no existe. Vuélvelo a conectar.",
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
          field: "amount",
          message: "Escribe cuánto tiempo esperar (mínimo 1).",
        });
      }
      if (!cfg.unit || !["minutes", "hours", "days"].includes(cfg.unit)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "unit",
          message: "Elige la unidad de tiempo: minutos, horas o días.",
        });
      }
      if (cfg.next_node_key && !knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este paso apunta a otro que ya no existe. Vuélvelo a conectar.",
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
          field: "intents",
          message:
            "Agrega al menos una intención (ej: \"quiere comprar\", \"pide ayuda\").",
        });
      }
      (cfg.intents ?? []).forEach((i, idx) => {
        if (!i.intent_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `intents.${idx}.intent_key`,
            message: `Falta el nombre de la intención ${idx + 1}.`,
          });
        }
        if (i.next_node_key && !knownKeys.has(i.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `intents.${idx}.next_node_key`,
            message: `La intención "${i.intent_key ?? idx + 1}" apunta a un paso que ya no existe. Vuélvela a conectar.`,
          });
        }
      });
      if (cfg.fallback_next_key && !knownKeys.has(cfg.fallback_next_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "fallback_next_key",
          message:
            "La rama \"No entendí\" apunta a un paso que ya no existe. Vuélvela a conectar.",
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
          field: "kind",
          message:
            "Elige qué buscar en Shopify (pedido por número, último pedido, producto, etc.).",
        });
      }
      if (!cfg.output_prefix) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "output_prefix",
          message:
            "Ponle un nombre al resultado para usarlo después en variables (ej: pedido, producto).",
        });
      }
      const branches: Array<["found_next_key" | "not_found_next_key", string]> = [
        ["found_next_key", "Encontrado"],
        ["not_found_next_key", "No encontrado"],
      ];
      for (const [field, label] of branches) {
        const k = cfg[field];
        if (k && !knownKeys.has(k)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field,
            message: `La rama "${label}" apunta a un paso que ya no existe. Vuélvela a conectar.`,
          });
        }
      }
      break;
    }

    case "customer_reply": {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Falta conectar este paso al siguiente. Después de que el cliente responda, ¿qué pasa?",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message:
            "Este paso apunta a otro que ya no existe. Vuélvelo a conectar.",
        });
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
        message: `Tipo de paso desconocido: "${node.node_type}". Bórralo y vuelve a agregarlo desde el menú.`,
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
    case "customer_reply":
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
