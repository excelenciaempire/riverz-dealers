import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Contact, Conversation } from '@/types';
import type { AiAgent } from './types';
import { getAnthropic } from './anthropic-client';
import { MIN_DEBOUNCE_SECONDS } from './types';
import { resolveAnthropicKey } from './platform-key';
import {
  buildSystemPrompt,
  loadContext,
  loadProductCatalog,
  loadRecentContactNotes,
  detectInboundProduct,
  getStickyAgentId,
  pickAgent,
  resolveShopifyContext,
} from './runner';
import { LOOKUP_ORDER_TOOL, runWithTools } from './tools';
import { loadPrimaryContact } from '@/lib/contacts/dedupe';
import { enrichContactFromShopify } from '@/lib/contacts/enrich';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { loadInstagramContext } from '@/lib/instagram-agent/agent-context';
import { briefDeVideo, videoDelHilo } from '@/lib/channels/tiktok_comment/videos';

/**
 * BORRADOR — el mismo cerebro del asistente escribe la respuesta, pero para
 * que la mande una persona.
 *
 * El botón de al lado del de mejorar redacción: en vez de reescribir lo que
 * quien atiende ya tipeó, propone qué contestar leyendo la conversación
 * entera y lo que el agente sabe del producto (su `training_material`, el
 * catálogo, el pedido del cliente, sus notas). Es el agente el que redacta,
 * así que el borrador suena igual que lo que ese comercio ya contesta solo.
 *
 * SOLO COMPONE. No envía, no persiste, no escribe en `ai_replies`. Un
 * borrador descartado no debe consumir el presupuesto de escalado ni pegarle
 * un agente a la conversación, y por eso tampoco toca `ai_summary`.
 *
 * Herramientas: sólo la de CONSULTAR un pedido. Es de lectura. Las que
 * escriben —crear checkout, crear pedido— quedan afuera a propósito: un
 * borrador que nadie llegó a mandar no puede dejar carritos ni pedidos
 * colgados en la tienda.
 *
 * Devuelve `null` ante cualquier fallo; nunca lanza.
 */

export type BorradorError =
  | 'sin_clave'
  | 'sin_contacto'
  | 'vacio'
  | 'fallo';

export interface BorradorResultado {
  text: string | null;
  error: BorradorError | null;
}

export async function componerBorrador(
  db: SupabaseClient,
  input: { workspaceId: string; conversation: Conversation },
): Promise<BorradorResultado> {
  try {
    const conversation = input.conversation;

    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', conversation.contact_id)
      .maybeSingle();
    const contact = contactRow as Contact | null;
    if (!contact) return { text: null, error: 'sin_contacto' };

    // Lo último que dijo el cliente manda: es lo que hay que contestar y lo
    // que decide de qué producto se está hablando.
    const { data: ultimoRow } = await db
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultimoCliente = String(
      (ultimoRow as { content_text?: string | null } | null)?.content_text ?? '',
    );

    const productMatch = await detectInboundProduct(
      db,
      input.workspaceId,
      ultimoCliente,
    );
    // Mismo arbitraje que cuando contesta solo: el agente que ya venía
    // atendiendo este hilo, y si no el que corresponde al canal y al producto.
    const stickyAgentId = await getStickyAgentId(db, conversation.id);
    const agent = await agenteParaBorrador(db, input.workspaceId, conversation.channel, {
      productMatch,
      stickyAgentId,
      inboundText: ultimoCliente,
    });

    const resolvedKey = await resolveAnthropicKey(db, {
      workspaceId: input.workspaceId,
      agentKeyEncrypted: agent.api_key_encrypted,
    });
    if (!resolvedKey) return { text: null, error: 'sin_clave' };

    const primaryContact = await loadPrimaryContact(db, contact);
    const [shopifySnapshot, recentNotes, context, products, businessCurrency, igContext] =
      await Promise.all([
        enrichContactFromShopify(db, primaryContact).catch(() => null),
        loadRecentContactNotes(db, primaryContact.id),
        loadContext(db, conversation, agent.context_messages || 30),
        loadProductCatalog(db, agent, input.workspaceId, productMatch),
        resolveWorkspaceCurrency(db, input.workspaceId),
        contextoDeLaPublicacion(db, input.workspaceId, conversation).catch(() => null),
      ]);

    // El contexto de Shopify entra para que el prompt tenga la ficha del
    // cliente y el precio real, pero SIN permiso de crear nada.
    const shopify = await resolveShopifyContext(
      db,
      input.workspaceId,
      contact,
      productMatch,
    );
    if (shopify) {
      shopify.canCreateOrders = false;
      shopify.workspaceId = input.workspaceId;
      shopify.agentId = agent.id;
      shopify.contactId = primaryContact.id;
      shopify.conversationId = conversation.id;
      shopify.contactName = contact.name ?? null;
      shopify.currency = shopify.config?.currency || businessCurrency;
    }

    let system = buildSystemPrompt(
      agent,
      contact,
      primaryContact,
      shopifySnapshot,
      recentNotes,
      context,
      products,
      productMatch,
      shopify,
      igContext,
      businessCurrency,
    );
    system += `\n\n## Esto es un BORRADOR\n${REGLAS_BORRADOR}`;

    // La API exige que el primer turno sea del usuario.
    let messages = context.messages.filter((m) => m.role === 'user' || m.content);
    while (messages.length && messages[0].role !== 'user') messages = messages.slice(1);
    if (messages.length === 0) return { text: null, error: 'vacio' };
    const claudeMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content || (m.role === 'user' ? 'Hola.' : ' '),
    }));

    // El hilo termina con algo NUESTRO: el cliente no volvió a escribir.
    // Pedirle al modelo que "conteste" ahí devolvía vacío —no hay nada que
    // contestar— y el botón parecía roto justo donde más se usa: retomar una
    // conversación que se quedó sin respuesta.
    if (claudeMessages[claudeMessages.length - 1]?.role === 'assistant') {
      claudeMessages.push({
        role: 'user',
        content:
          '[La persona no volvió a escribir. Escribe un mensaje breve para retomar: engancha con lo último que se dijo y facilita el siguiente paso. No saludes de nuevo ni repitas lo ya enviado.]',
      });
    }

    const maxChars = agent.max_response_chars || 500;
    const result = await runWithTools(getAnthropic(resolvedKey.key), {
      model: agent.model || 'claude-haiku-4-5-20251001',
      max_tokens: Math.max(64, Math.min(2048, Math.ceil(maxChars / 2))),
      system,
      messages: claudeMessages,
      tools: shopify ? [LOOKUP_ORDER_TOOL] : [],
      shopify,
      voice: null,
    });

    const text = (result.text ?? '').trim();
    if (!text) return { text: null, error: 'vacio' };
    return {
      text: text.length > maxChars ? text.slice(0, maxChars).trimEnd() : text,
      error: null,
    };
  } catch (err) {
    console.error('[borrador] fallo:', err);
    return { text: null, error: 'fallo' };
  }
}

/**
 * De qué está colgado este hilo.
 *
 * En Instagram es la ficha de la persona ("un solo cerebro"); en TikTok es el
 * video, que es a quien le habla el comentario. Los dos terminan en el mismo
 * lugar del prompt porque los dos responden a lo mismo: qué más hay que saber
 * antes de contestar acá.
 */
async function contextoDeLaPublicacion(
  db: SupabaseClient,
  workspaceId: string,
  conversation: Conversation,
): Promise<string | null> {
  if (conversation.channel === 'tiktok_comment') {
    const videoId = videoDelHilo(
      (conversation as { thread_external_id?: string | null }).thread_external_id,
    );
    return videoId ? briefDeVideo(db, workspaceId, videoId) : null;
  }
  return loadInstagramContext(db, conversation.contact_id);
}

/**
 * Quién redacta el borrador.
 *
 * NO es el mismo requisito que contestar solo. El runner exige un agente
 * ACTIVO y con el canal habilitado, y con razón: nadie quiere que un agente
 * apagado le hable a un cliente. Pero acá no habla nadie —el texto cae en el
 * cuadro de escritura y lo manda una persona—, así que exigir lo mismo dejaba
 * el botón muerto justo para quien más lo necesita: el comercio que apagó el
 * asistente para contestar a mano.
 *
 * Tres escalones:
 *   1. El agente que atendería este canal, si está activo.
 *   2. Cualquier agente del comercio aunque esté apagado — su persona, su
 *      conocimiento y sus productos siguen siendo los de la marca.
 *   3. Ninguno: un redactor genérico. Igual escribe con la conversación
 *      entera, el catálogo real, la ficha del cliente y sus notas, que es de
 *      donde sale casi todo el valor.
 */
async function agenteParaBorrador(
  db: SupabaseClient,
  workspaceId: string,
  channel: Conversation['channel'],
  routing: {
    productMatch: Awaited<ReturnType<typeof detectInboundProduct>>;
    stickyAgentId: string | null;
    inboundText: string;
  },
): Promise<AiAgent> {
  const activo = await pickAgent(db, workspaceId, channel, routing);
  if (activo && activo.provider === 'anthropic') return activo;

  const { data } = await db
    .from('ai_agents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'anthropic')
    .is('deleted_at', null)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const apagado = data as AiAgent | null;
  if (apagado) return apagado;

  // Sin ningún agente: el redactor genérico se presenta con el nombre del
  // comercio. Si se queda con un nombre inventado, el modelo lo dice en voz
  // alta ("soy Borrador, el asistente de la tienda") y el cliente lee algo
  // que no existe.
  const { data: ws } = await db
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();
  return redactorGenerico(workspaceId, (ws as { name?: string } | null)?.name ?? null);
}

/** El agente que no existe: sólo lo suficiente para armar el prompt. Nunca se
 *  guarda ni se muestra en ningún lado. */
function redactorGenerico(workspaceId: string, nombreDelComercio: string | null): AiAgent {
  const ahora = new Date().toISOString();
  return {
    id: '00000000-0000-0000-0000-000000000000',
    workspace_id: workspaceId,
    name: nombreDelComercio?.trim() || 'la tienda',
    is_active: false,
    role: 'general',
    permissions: null,
    tools: null,
    persona:
      'Atiendes a los clientes de esta tienda por chat. Conoces los productos del catálogo que aparece más abajo y contestas con eso, con la conversación y con lo que diga la publicación que están comentando; lo que no sabes, no lo inventas.',
    knowledge: null,
    knowledge_url: null,
    knowledge_synced_at: null,
    language: 'es',
    tone: 'friendly',
    max_response_chars: 500,
    reply_delay_seconds: 0,
    context_messages: 30,
    response_mode: 'single',
    inbound_debounce_seconds: MIN_DEBOUNCE_SECONDS,
    reply_burst_max: 20,
    requires_approval: false,
    reply_when_assigned: false,
    reply_outside_hours: true,
    business_hours: null,
    escalate_keywords: [],
    escalate_after_messages: null,
    followup_enabled: false,
    followup_delay_hours: 24,
    followup_max_count: 0,
    puede_crear_pedidos: false,
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    api_key_encrypted: null,
    scope: 'workspace',
    product_scope: 'all',
    priority: 0,
    voice_enabled: false,
    voice_provider: 'elevenlabs',
    voice_id: null,
    voice_greeting: null,
    voice_system_prompt: null,
    voice_objectives: {},
    voice_max_call_seconds: 0,
    voice_calling_hours: null,
    voice_max_retries: 0,
    voice_retry_delay_minutes: 0,
    voice_ai_decides: false,
    created_at: ahora,
    updated_at: ahora,
    created_by: null,
  } as AiAgent;
}

/**
 * Lo que cambia respecto de contestar solo: acá hay alguien que va a leer el
 * texto antes de mandarlo, y ese alguien lo va a editar. Un borrador con
 * huecos —"[nombre]", "confirmar precio"— es peor que uno corto.
 */
const REGLAS_BORRADOR = [
  'Escribe la respuesta que le mandarías a esta persona ahora mismo, lista para enviar.',
  'Contesta LO QUE DIJO. Si comenta algo del video o del producto —un ingrediente, la edad, el sol, la piel, el precio, el envío— eso ES del negocio: respóndelo con lo que sabes del video y del catálogo, no lo trates como fuera de tema.',
  'Nunca escribas que te falta contexto, que no entiendes la conversación previa, que eres una IA, ni que sólo puedes ayudar con productos y pedidos. Si de verdad no se entiende qué quiso decir, haz UNA pregunta corta y natural.',
  'No uses el nombre de usuario de la red social como si fuera su nombre.',
  'Nada de encabezados, opciones numeradas, alternativas ni notas para quien atiende: sólo el mensaje.',
  'Sin espacios para completar ni corchetes. Si un dato no lo sabes, no lo menciones.',
  'Una sola respuesta, del largo de un mensaje de chat.',
].join('\n');
