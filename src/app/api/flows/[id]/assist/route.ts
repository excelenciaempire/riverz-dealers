import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/anthropic-client";
import { createClient } from "@/lib/supabase/server";
import { csrfGuard } from "@/lib/csrf";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import {
  ASSIST_TOOL_NAME,
  ASSIST_TOOL_SCHEMA,
  isPatch,
  validatePatchedSnapshot,
  type AiPatch,
  type AssistResponse,
} from "@/lib/flows/ai-patches";

/**
 * POST /api/flows/[id]/assist
 *
 * Constructor IA dentro del lienzo del editor de flujos. El cliente
 * manda:
 *   - `message`: lo que el usuario tipeó en el chat ("agrega un botón
 *     que diga Comprar y conéctalo a un mensaje con el link")
 *   - `flow_snapshot`: estado actual del builder (nodos + trigger).
 *     Incluye coordenadas para que la IA pueda ubicar cosas nuevas con
 *     contexto, y conexiones para que entienda el grafo.
 *   - `history`: turnos previos del chat (opcional) para continuidad.
 *
 * La IA responde via Anthropic tool-use (forzado con `tool_choice`)
 * con un objeto `{reply, patches[]}` que el cliente aplica al estado
 * local — la persistencia real ocurre cuando el usuario pulsa Guardar
 * (idéntico al flujo de cualquier otra edición manual).
 *
 * No hay autosave intencional: la IA propone, el usuario revisa y
 * decide. Si arruina algo, Ctrl+Z reverte el turn entero porque cada
 * batch de patches es UN solo push del undo stack.
 */

interface AssistRequestBody {
  message: string;
  flow_snapshot: {
    name?: string;
    trigger_type: "keyword" | "first_inbound_message" | "manual";
    trigger_config: Record<string, unknown>;
    trigger_position?: { x: number; y: number };
    entry_node_id: string | null;
    nodes: Array<{
      node_key: string;
      node_type: string;
      config: Record<string, unknown>;
      position_x?: number;
      position_y?: number;
    }>;
  };
  /** Productos sincronizados del workspace para que la IA pueda referenciarlos. */
  products?: Array<{ title: string; handle: string }>;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const locale = await getLocale();

  // ── Auth + propiedad del flujo ──
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: flow } = await supabase
    .from("flows")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!flow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as AssistRequestBody | null;
  if (!body || !body.message?.trim() || !body.flow_snapshot) {
    return NextResponse.json(
      { error: translate(locale, "errFlows.assistMissingFields") },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: translate(locale, "errFlows.assistAnthropicNotConfigured"),
      },
      { status: 500 },
    );
  }

  // ── Llamada a Claude con tool-use forzado ──
  const client = getAnthropic(apiKey);
  const system = buildSystemPrompt(body.flow_snapshot, body.products ?? [], locale);

  const historyTurns = (body.history ?? []).slice(-10);
  const messages: Anthropic.MessageParam[] = [
    ...historyTurns.map<Anthropic.MessageParam>((t) => ({
      role: t.role,
      content: t.content,
    })),
    { role: "user", content: body.message },
  ];

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      messages,
      tools: [
        {
          name: ASSIST_TOOL_NAME,
          description:
            "Responde al usuario y devuelve la lista de cambios a aplicar al flujo (puede estar vacía si el usuario solo hizo una pregunta).",
          input_schema: ASSIST_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: ASSIST_TOOL_NAME },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Anthropic API failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // El tool_choice forzado garantiza que viene un tool_use; si no,
  // algo cambió en el lado de Anthropic y devolvemos error claro.
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    return NextResponse.json(
      {
        error: translate(locale, "errFlows.assistUnexpectedAiResponse"),
      },
      { status: 502 },
    );
  }

  const parsed = toolUse.input as Partial<AssistResponse>;
  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : translate(locale, "errFlows.assistDefaultReply");
  const patches = Array.isArray(parsed.patches)
    ? (parsed.patches.filter(isPatch) as AiPatch[])
    : [];

  // Revalidamos simulando los patches contra el snapshot. Si introducen
  // errores nuevos (ej: un wire que apunta a un node_key inexistente,
  // un ciclo, un shopify_lookup sin ramas), rechazamos el turn entero
  // antes de que el cliente lo aplique al lienzo.
  if (patches.length > 0) {
    const newIssues = validatePatchedSnapshot(
      {
        name: body.flow_snapshot.name,
        trigger_type: body.flow_snapshot.trigger_type,
        trigger_config: body.flow_snapshot.trigger_config,
        entry_node_id: body.flow_snapshot.entry_node_id,
        nodes: body.flow_snapshot.nodes.map((n) => ({
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
        })),
      },
      patches,
    );
    if (newIssues.length > 0) {
      const detail = newIssues.map((i) => i.message).join(" ");
      return NextResponse.json(
        {
          error: translate(locale, "errFlows.assistPatchesWouldBreak", {
            detail,
          }),
        },
        { status: 422 },
      );
    }
  }

  const result: AssistResponse = { reply, patches };
  return NextResponse.json(result);
}

/**
 * System prompt — describe el modelo del lienzo, las herramientas,
 * y le pasa el snapshot del flujo actual. El idioma de la respuesta Y del
 * contenido generado para los nodos sigue el locale del merchant: un
 * merchant de habla inglesa obtiene chat y mensajes de flujo en inglés.
 */
function buildSystemPrompt(
  snapshot: AssistRequestBody["flow_snapshot"],
  products: Array<{ title: string; handle: string }>,
  locale: Locale,
): string {
  const langLabel =
    locale === "en"
      ? 'natural English (en-US)'
      : 'español neutro, sin voseo (usa "tú" o impersonal)';
  const productsBlock =
    products.length > 0
      ? `\nProductos sincronizados del merchant (úsalos cuando el usuario te pida links a productos específicos):\n${products
          .slice(0, 30)
          .map((p) => `- ${p.title} (handle: ${p.handle})`)
          .join("\n")}\n`
      : "\nEl merchant todavía no tiene productos sincronizados desde Shopify. Si el usuario pide links de productos, sugiérele agregarlos primero en /productos.\n";

  return `Eres una IA asistente embebida en el editor de flujos de WhatsApp de Riverz.
El usuario te habla en lenguaje natural y tú editas el flujo aplicando "patches" estructurados con la herramienta \`${ASSIST_TOOL_NAME}\`.

Idioma (OBLIGATORIO):
- Escribe tu \`reply\` en ${langLabel}.
- TODO el contenido que generes para los nodos del flujo (textos de mensajes, títulos de botones, filas de listas, prompts de captura, intents, etc.) DEBE estar en ${langLabel}. Estos mensajes los lee el cliente final del merchant.

Estilo de respuesta:
- Sin guiones largos (—) ni encabezados markdown (##).
- Frases cortas y al grano. Nada que suene a script generado.

Reglas:
- SIEMPRE usas la herramienta \`${ASSIST_TOOL_NAME}\` para responder. No contestes solo con texto.
- Si el usuario hace una pregunta o saluda (no pide cambios), devuelve \`patches: []\` y responde en \`reply\`.
- Si el usuario pide algo ambiguo, devuelve \`patches: []\` y en \`reply\` haz UNA pregunta corta para aclarar.
- Los node_key son slugs en minúsculas con guion bajo, únicos. Cuando agregas un nodo nuevo, inventa uno descriptivo (por ejemplo \`enviar_link_tienda\`, \`preguntar_ciudad\`).
- Cuando hagas wire entre nodos, asegura que ambos extremos existan (en el snapshot o en patches previos del mismo turno).
- Para mensajes de texto largos respeta saltos de línea con \\n.
- Cuando el usuario quiera mostrar un producto del merchant, usa los productos sincronizados de abajo. Si tu nodo es \`send_cta_url\`, arma el url como https://tienda.com/products/{handle} solo si conoces el dominio; si no, usa send_message con el handle y deja que el usuario complete el dominio.

Tipos de nodo y su \`config\`:
- \`send_message\`: { text: string, next_node_key?: string }
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
- \`start\`: { next_node_key: string }. Úsalo solo si el usuario lo pide explícitamente. Lo normal es marcar el primer paso con \`set_entry\`.

Cómo conectar nodos (\`wire\` patch):
- \`kind_of_port: "text"\` — para todos los nodos lineales (send_message, send_image, etc.). Setea \`next_node_key\`.
- \`kind_of_port: "button"\` con \`port_index: N\` — el botón N de un send_buttons.
- \`kind_of_port: "list_row"\` con \`port_index: N\` — la fila N (índice plano que recorre TODAS las secciones).
- \`kind_of_port: "true_branch"\`/\`false_branch\` — ramas de condition.
- \`kind_of_port: "found_branch"\`/\`not_found_branch\` — ramas de shopify_lookup.
- \`kind_of_port: "intent"\` con \`port_index: N\` — la intención N de ai_intent.
- \`kind_of_port: "intent_fallback"\` — la rama "No entendí" de ai_intent.

Posiciones de nuevos nodos: el lienzo es 6000x4000. Los nodos suelen tener ~260px de ancho. Si no especificas \`position\` al agregar, el cliente lo coloca a la derecha del más a la derecha. Si quieres ubicar varios nodos relacionados juntos, devuelve \`position\` en cada uno.
${productsBlock}
Estado actual del flujo:
${JSON.stringify(snapshot, null, 2)}`;
}
