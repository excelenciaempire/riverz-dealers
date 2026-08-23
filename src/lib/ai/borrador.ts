import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Contact, Conversation } from '@/types';
import type { AiAgent } from './types';
import { getAnthropic } from './anthropic-client';
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
  | 'sin_agente'
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
    const agent: AiAgent | null = await pickAgent(
      db,
      input.workspaceId,
      conversation.channel,
      { productMatch, stickyAgentId, inboundText: ultimoCliente },
    );
    if (!agent || agent.provider !== 'anthropic') {
      return { text: null, error: 'sin_agente' };
    }

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
        loadInstagramContext(db, primaryContact.id).catch(() => null),
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
 * Lo que cambia respecto de contestar solo: acá hay alguien que va a leer el
 * texto antes de mandarlo, y ese alguien lo va a editar. Un borrador con
 * huecos —"[nombre]", "confirmar precio"— es peor que uno corto.
 */
const REGLAS_BORRADOR = [
  'Escribe la respuesta que le mandarías a esta persona ahora mismo, lista para enviar.',
  'Nada de encabezados, opciones numeradas, alternativas ni notas para quien atiende: sólo el mensaje.',
  'Sin espacios para completar ni corchetes. Si un dato no lo sabes, no lo menciones.',
  'Una sola respuesta, del largo de un mensaje de chat.',
].join('\n');
