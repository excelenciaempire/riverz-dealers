/**
 * Patches que la IA constructora del lienzo puede emitir.
 *
 * El cliente le manda al endpoint `/api/flows/[id]/assist` un snapshot
 * del estado actual (nodos + disparador) + un mensaje del usuario en
 * lenguaje natural ("agrega un botón que diga Comprar y conéctalo a
 * un mensaje que mande el link de la tienda"). El endpoint llama a
 * Claude y le pide que devuelva un array de estos patches via tool-use.
 * El builder los aplica secuencialmente, lo que invalida los previews,
 * gatilla validación, y deja la operación entera en un único push del
 * undo stack (Ctrl+Z reverte TODOS los cambios del turn).
 *
 * Por qué tipados estrechos en vez de aceptar un JSON libre:
 *  - Validamos antes de aplicar (un patch corrupto se rechaza sin
 *    romper el estado del cliente).
 *  - El system prompt enumera estas operaciones y la IA sabe qué pedir.
 *  - El undo stack mantiene granularidad por turn de chat.
 */

import { SHOW_RIVERZ_IMPROVEMENTS } from "@/lib/ui/improvements-preview";
import type { FlowNodeType } from "./types";
import { validateFlowForActivation, type ValidationIssue } from "./validate";

export type AiPatch =
  | {
      kind: "add_node";
      node_key: string;
      node_type: FlowNodeType;
      config: Record<string, unknown>;
      /** Posición opcional. Si no se da, el builder lo coloca a la derecha. */
      position?: { x: number; y: number };
    }
  | {
      kind: "remove_node";
      node_key: string;
    }
  | {
      kind: "update_node_config";
      node_key: string;
      /** Se aplica con spread sobre el config actual (merge superficial). */
      config_patch: Record<string, unknown>;
    }
  | {
      kind: "move_node";
      node_key: string;
      position: { x: number; y: number };
    }
  | {
      kind: "wire";
      from_node_key: string;
      /** "text" para nodos con un solo next_node_key; "button"/"list_row" con índice
       *  para nodos interactivos; "true_branch"/"false_branch" para condition;
       *  "found_branch"/"not_found_branch" para shopify_lookup;
       *  "intent" con índice para ai_intent; "intent_fallback" para su rama default. */
      kind_of_port:
        | "text"
        | "button"
        | "list_row"
        | "true_branch"
        | "false_branch"
        | "found_branch"
        | "not_found_branch"
        | "intent"
        | "intent_fallback";
      /** Índice de la rama. Sólo aplica para button/list_row/intent. */
      port_index?: number;
      to_node_key: string;
    }
  | {
      kind: "set_entry";
      node_key: string;
    }
  | {
      kind: "set_trigger";
      trigger_type: "keyword" | "first_inbound_message" | "manual";
      trigger_config: Record<string, unknown>;
    };

/**
 * Resultado que devuelve `/assist`. `reply` es el texto humano para
 * mostrar en el panel de chat ("Listo, agregué un botón…"). `patches`
 * es la lista que el builder aplica.
 */
export interface AssistResponse {
  reply: string;
  patches: AiPatch[];
}

/**
 * JSON Schema que le pasamos al `tools[]` del cliente Anthropic.
 * Forzamos a la IA a usar la herramienta `apply_changes` con esta
 * forma; los `enum`s mantienen el universo de tipos cerrado.
 */
export const ASSIST_TOOL_NAME = "apply_changes";
export const ASSIST_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    reply: {
      type: "string",
      description:
        "Respuesta corta para el usuario (1-2 frases) en español, explicando lo que vas a hacer o pidiendo aclaración. Esta cadena se muestra en el panel de chat.",
    },
    patches: {
      type: "array",
      description:
        "Operaciones que se aplicarán al flujo. Si el pedido del usuario no requiere cambios (es una pregunta o saludo), deja este array vacío.",
      items: {
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["add_node"] },
              node_key: {
                type: "string",
                description:
                  "Identificador del nuevo nodo. Slug en minúsculas con guiones bajos, único en el flujo (ej: enviar_link_tienda).",
              },
              node_type: {
                type: "string",
                enum: [
                  "send_message",
                  "send_buttons",
                  "send_list",
                  "send_image",
                  "send_video",
                  "send_document",
                  "send_cta_url",
                  "collect_input",
                  "customer_reply",
                  "condition",
                  "set_tag",
                  "handoff",
                  "wait",
                  "ai_intent",
                  "shopify_lookup",
                  ...(SHOW_RIVERZ_IMPROVEMENTS ? ["http_action"] : []),
                  "subflow",
                  "end",
                ],
              },
              config: {
                type: "object",
                description:
                  "Config inicial del nodo. Esquema depende del node_type — ver SCHEMA_HINTS.",
              },
              position: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["x", "y"],
              },
            },
            required: ["kind", "node_key", "node_type", "config"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["remove_node"] },
              node_key: { type: "string" },
            },
            required: ["kind", "node_key"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["update_node_config"] },
              node_key: { type: "string" },
              config_patch: {
                type: "object",
                description:
                  "Se hace merge superficial con el config actual. Para cambiar el texto de un mensaje: {text: 'nuevo texto'}.",
              },
            },
            required: ["kind", "node_key", "config_patch"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["move_node"] },
              node_key: { type: "string" },
              position: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["x", "y"],
              },
            },
            required: ["kind", "node_key", "position"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["wire"] },
              from_node_key: { type: "string" },
              kind_of_port: {
                type: "string",
                enum: [
                  "text",
                  "button",
                  "list_row",
                  "true_branch",
                  "false_branch",
                  "found_branch",
                  "not_found_branch",
                  "intent",
                  "intent_fallback",
                ],
              },
              port_index: { type: "number" },
              to_node_key: { type: "string" },
            },
            required: ["kind", "from_node_key", "kind_of_port", "to_node_key"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["set_entry"] },
              node_key: { type: "string" },
            },
            required: ["kind", "node_key"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["set_trigger"] },
              trigger_type: {
                type: "string",
                enum: ["keyword", "first_inbound_message", "manual"],
              },
              trigger_config: { type: "object" },
            },
            required: ["kind", "trigger_type", "trigger_config"],
          },
        ],
      },
    },
  },
  required: ["reply", "patches"],
};

/**
 * Qué config lleva cada tipo de paso, y cómo se conectan.
 *
 * Vivía adentro del system prompt de `/api/flows/[id]/assist`, que era su único
 * lector. Ahora también lo lee la capacidad `flujos.editar`: el mismo DSL, dos
 * modelos escribiéndolo. Si cada uno tuviera su propia copia, el día que se
 * agregue un tipo de paso uno de los dos seguiría emitiendo patches viejos y el
 * validador los rechazaría sin que nadie entienda por qué.
 */
export const NODOS_Y_CONFIG = `- \`send_message\`: { text: string, next_node_key?: string }
- \`send_buttons\`: { text: string, footer_text?: string, buttons: Array<{reply_id: string, title: string (≤20 chars), next_node_key?: string}> } — máximo 3 botones
- \`send_list\`: { text: string, button_label: string, sections: Array<{title?: string, rows: Array<{reply_id: string, title: string (≤24 chars), description?: string, next_node_key?: string}>}> } — máximo 10 filas en total
- \`send_image\`/\`send_video\`/\`send_document\`: { url: string (https), caption?: string, next_node_key?: string }
- \`send_cta_url\`: { text: string, button_title: string, url: string (https), next_node_key?: string }
- \`collect_input\`: { prompt_text: string, var_key: string (snake_case), next_node_key?: string }
- \`customer_reply\`: { next_node_key?: string }. Pausa el flujo hasta que el cliente envíe un mensaje (cualquier texto). No envía nada, no captura nada. Úsalo entre dos send_message cuando quieres que el bot mande algo, deje al cliente responder, y recién después siga. NO lo uses después de send_buttons, send_list, collect_input o ai_intent: esos ya esperan respuesta.
- \`subflow\`: { sub_flow_id: string, next_node_key?: string }. Ejecuta otro flujo reutilizable dentro de este. Usalo para encapsular secuencias comunes (ej: "pedir email y verificar") y referenciarlas desde varios flujos sin duplicar nodos. Si el usuario te pide insertar un subflow, pídele primero el nombre o el id del flujo destino antes de proponer la configuración.
- \`condition\`: { subject: "var"|"tag"|"contact_field", subject_key: string, operator: "equals"|"contains"|"present"|"absent", value?: string, true_next?: string, false_next?: string }
- \`set_tag\`: { mode: "add"|"remove", tag_id: string, next_node_key?: string }
- \`handoff\`: { reason?: string, message?: string }
- \`wait\`: { amount: number, unit: "minutes"|"hours"|"days", next_node_key?: string }
- \`ai_intent\`: { prompt_text: string, intents: Array<{intent_key: string, description: string, next_node_key?: string}>, fallback_next_key?: string }
- \`shopify_lookup\`: { kind: "order_by_number"|"order_by_email"|"last_order"|"product_by_handle", output_prefix: string, found_next_key?: string, not_found_next_key?: string }
- \`end\`: {}
- \`start\`: { next_node_key: string }. Úsalo solo si el usuario lo pide explícitamente. Lo normal es marcar el primer paso con \`set_entry\`.` + (SHOW_RIVERZ_IMPROVEMENTS ? `
- \`http_action\`: { action_id: UUID, action_revision: integer, input_vars: Record<parameter_key, flow_variable_key>, output_prefix: string, next_node_key: string }. Solo lecturas GET con contact_id del servidor. No inventes IDs ni revisiones: el administrador debe elegir una acción existente, guardar el flujo y autorizar la configuración exacta. No incluyas URL, credenciales ni autorizaciones en patches.` : '')

/** Los puertos de salida de cada tipo de paso, para el patch `wire`. */
export const PUERTOS_Y_CABLEADO = `- \`kind_of_port: "text"\` — para todos los nodos lineales (send_message, send_image, etc.). Setea \`next_node_key\`.
- \`kind_of_port: "button"\` con \`port_index: N\` — el botón N de un send_buttons.
- \`kind_of_port: "list_row"\` con \`port_index: N\` — la fila N (índice plano que recorre TODAS las secciones).
- \`kind_of_port: "true_branch"\`/\`false_branch\` — ramas de condition.
- \`kind_of_port: "found_branch"\`/\`not_found_branch\` — ramas de shopify_lookup.
- \`kind_of_port: "intent"\` con \`port_index: N\` — la intención N de ai_intent.
- \`kind_of_port: "intent_fallback"\` — la rama "No entendí" de ai_intent.`

/**
 * Validación estructural antes de aplicar. Es estricta a propósito:
 * si la IA emite un patch con campos faltantes o tipos inválidos, lo
 * descartamos en silencio en vez de pushearlo al reducer (un
 * node_type inválido como "send_video_message" voltearía el editor
 * porque NODE_META[node_type] sería undefined). El endpoint llama a
 * esto y filtra; el reducer puede asumir que cada AiPatch que recibe
 * tiene todos sus campos requeridos bien formados.
 */
const VALID_NODE_TYPES = new Set<string>([
  "start",
  "send_message",
  "send_buttons",
  "send_list",
  "send_image",
  "send_video",
  "send_document",
  "send_cta_url",
  "collect_input",
  "customer_reply",
  "condition",
  "set_tag",
  "handoff",
  "wait",
  "ai_intent",
  "shopify_lookup",
  ...(SHOW_RIVERZ_IMPROVEMENTS ? ["http_action"] : []),
  "subflow",
  "end",
]);

const VALID_PORTS = new Set<string>([
  "text",
  "button",
  "list_row",
  "true_branch",
  "false_branch",
  "found_branch",
  "not_found_branch",
  "intent",
  "intent_fallback",
]);

const VALID_TRIGGER_TYPES = new Set<string>([
  "keyword",
  "first_inbound_message",
  "manual",
]);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

export function isPatch(x: unknown): x is AiPatch {
  if (!isPlainObject(x)) return false;
  const kind = x.kind;
  switch (kind) {
    case "add_node":
      return (
        isNonEmptyString(x.node_key) &&
        typeof x.node_type === "string" &&
        VALID_NODE_TYPES.has(x.node_type) &&
        isPlainObject(x.config) &&
        (x.position === undefined ||
          (isPlainObject(x.position) &&
            typeof x.position.x === "number" &&
            typeof x.position.y === "number"))
      );
    case "remove_node":
      return isNonEmptyString(x.node_key);
    case "update_node_config":
      return isNonEmptyString(x.node_key) && isPlainObject(x.config_patch);
    case "move_node":
      return (
        isNonEmptyString(x.node_key) &&
        isPlainObject(x.position) &&
        typeof x.position.x === "number" &&
        typeof x.position.y === "number"
      );
    case "wire":
      return (
        isNonEmptyString(x.from_node_key) &&
        isNonEmptyString(x.to_node_key) &&
        typeof x.kind_of_port === "string" &&
        VALID_PORTS.has(x.kind_of_port) &&
        (x.port_index === undefined || typeof x.port_index === "number")
      );
    case "set_entry":
      return isNonEmptyString(x.node_key);
    case "set_trigger":
      return (
        typeof x.trigger_type === "string" &&
        VALID_TRIGGER_TYPES.has(x.trigger_type) &&
        isPlainObject(x.trigger_config)
      );
    default:
      return false;
  }
}

// ============================================================
// Simulación + revalidación
// ============================================================

export interface FlowSnapshot {
  name?: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  nodes: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
  }>;
}

/**
 * Aplica los patches a una copia inmutable del snapshot para poder
 * revalidar antes de devolvérselos al cliente. Es una versión
 * "headless" de applyAiPatches del builder — no toca posiciones, no
 * preserva entry default, solo el grafo lógico que valida el
 * validator (nodes + edges + trigger + entry).
 */
export function simulateApplyPatches(
  snapshot: FlowSnapshot,
  patches: AiPatch[],
): FlowSnapshot {
  let next: FlowSnapshot = {
    ...snapshot,
    trigger_config: { ...snapshot.trigger_config },
    nodes: snapshot.nodes.map((n) => ({
      ...n,
      config: { ...n.config },
    })),
  };
  for (const p of patches) {
    switch (p.kind) {
      case "add_node": {
        if (next.nodes.some((n) => n.node_key === p.node_key)) break;
        next = {
          ...next,
          nodes: [
            ...next.nodes,
            {
              node_key: p.node_key,
              node_type: p.node_type,
              config: { ...p.config },
            },
          ],
          entry_node_id: next.entry_node_id ?? p.node_key,
        };
        break;
      }
      case "remove_node": {
        next = {
          ...next,
          nodes: next.nodes.filter((n) => n.node_key !== p.node_key),
          entry_node_id:
            next.entry_node_id === p.node_key ? null : next.entry_node_id,
        };
        break;
      }
      case "update_node_config": {
        next = {
          ...next,
          nodes: next.nodes.map((n) =>
            n.node_key === p.node_key
              ? { ...n, config: { ...n.config, ...p.config_patch } }
              : n,
          ),
        };
        break;
      }
      case "move_node":
        break;
      case "wire": {
        next = {
          ...next,
          nodes: next.nodes.map((n) => {
            if (n.node_key !== p.from_node_key) return n;
            const cfg = { ...n.config };
            const idx = p.port_index ?? 0;
            switch (p.kind_of_port) {
              case "text":
                cfg.next_node_key = p.to_node_key;
                break;
              case "button": {
                const btns = Array.isArray(cfg.buttons)
                  ? (cfg.buttons as Array<Record<string, unknown>>).slice()
                  : [];
                if (idx >= 0 && idx < btns.length) {
                  btns[idx] = { ...btns[idx], next_node_key: p.to_node_key };
                  cfg.buttons = btns;
                }
                break;
              }
              case "list_row": {
                const sections = Array.isArray(cfg.sections)
                  ? (cfg.sections as Array<{
                      title?: string;
                      rows?: Array<Record<string, unknown>>;
                    }>).map((s) => ({ ...s, rows: s.rows ? [...s.rows] : [] }))
                  : [];
                let remaining = idx;
                for (const s of sections) {
                  const rows = s.rows ?? [];
                  if (remaining < rows.length) {
                    rows[remaining] = {
                      ...rows[remaining],
                      next_node_key: p.to_node_key,
                    };
                    s.rows = rows;
                    remaining = -1;
                    break;
                  }
                  remaining -= rows.length;
                }
                cfg.sections = sections;
                break;
              }
              case "true_branch":
                cfg.true_next = p.to_node_key;
                break;
              case "false_branch":
                cfg.false_next = p.to_node_key;
                break;
              case "found_branch":
                cfg.found_next_key = p.to_node_key;
                break;
              case "not_found_branch":
                cfg.not_found_next_key = p.to_node_key;
                break;
              case "intent": {
                const intents = Array.isArray(cfg.intents)
                  ? (cfg.intents as Array<Record<string, unknown>>).slice()
                  : [];
                if (idx >= 0 && idx < intents.length) {
                  intents[idx] = {
                    ...intents[idx],
                    next_node_key: p.to_node_key,
                  };
                  cfg.intents = intents;
                }
                break;
              }
              case "intent_fallback":
                cfg.fallback_next_key = p.to_node_key;
                break;
            }
            return { ...n, config: cfg };
          }),
        };
        break;
      }
      case "set_entry": {
        if (next.nodes.some((n) => n.node_key === p.node_key)) {
          next = { ...next, entry_node_id: p.node_key };
        }
        break;
      }
      case "set_trigger": {
        next = {
          ...next,
          trigger_type: p.trigger_type,
          trigger_config: p.trigger_config,
        };
        break;
      }
    }
  }
  return next;
}

/**
 * Revalida después de simular los patches y devuelve los issues
 * 'error' NUEVOS que no existían en el snapshot original. Las warnings
 * y los errores preexistentes no bloquean la sugerencia — el merchant
 * los arregla en otros turnos.
 */
export function validatePatchedSnapshot(
  snapshot: FlowSnapshot,
  patches: AiPatch[],
  locale: 'es' | 'en' = 'es',
): ValidationIssue[] {
  const before = validateFlowForActivation(
    {
      name: snapshot.name ?? "tmp",
      trigger_type: snapshot.trigger_type,
      trigger_config: snapshot.trigger_config,
      entry_node_id: snapshot.entry_node_id,
    },
    snapshot.nodes,
    locale,
  ).filter((i) => i.severity === "error");
  const after = simulateApplyPatches(snapshot, patches);
  const afterIssues = validateFlowForActivation(
    {
      name: after.name ?? "tmp",
      trigger_type: after.trigger_type,
      trigger_config: after.trigger_config,
      entry_node_id: after.entry_node_id,
    },
    after.nodes,
    locale,
  ).filter((i) => i.severity === "error");
  const beforeKeys = new Set(
    before.map((i) => `${i.scope}|${i.node_key ?? ""}|${i.field ?? ""}|${i.message}`),
  );
  return afterIssues.filter(
    (i) =>
      !beforeKeys.has(
        `${i.scope}|${i.node_key ?? ""}|${i.field ?? ""}|${i.message}`,
      ),
  );
}
