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

import type { FlowNodeType } from "./types";

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
