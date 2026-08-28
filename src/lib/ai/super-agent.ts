import type { SupabaseClient } from '@supabase/supabase-js';
import { MODELO_POR_DEFECTO, reguladoPorEsfuerzo } from './esfuerzo';
import { salidaParaCliente, recortarSalida } from './salida';
import type Anthropic from '@anthropic-ai/sdk';
import type { Contact, Conversation } from '@/types';
import type { AiAgent } from './types';
import { getAnthropic } from './anthropic-client';
import { resolveAnthropicKey } from './platform-key';
import {
  buildSystemPrompt,
  construirHerramientas,
  loadContext,
  loadProductCatalog,
  loadRecentContactNotes,
  detectInboundProduct,
  resolveShopifyContext,
} from './runner';
import { runWithTools } from './tools';
import { toolEnabled } from './toolbox';
import { loadPrimaryContact } from '@/lib/contacts/dedupe';
import { enrichContactFromShopify } from '@/lib/contacts/enrich';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { loadInstagramContext } from '@/lib/instagram-agent/agent-context';

/**
 * SUPER AGENTE — el mismo cerebro del Asistente escribe también el PRIMER
 * mensaje de una respuesta a un comentario.
 *
 * El problema que cierra: hasta ahora ese primer mensaje lo escribía
 * `craftPersonalizedDM`, un redactor de una sola pasada sin herramientas. No
 * podía consultar un pedido, cotizar con el catálogo real, crear un checkout
 * ni escalar. Del segundo mensaje en adelante contestaba el agente completo.
 * O sea: medio agente justo en el momento de mayor intención, y el agente
 * entero después.
 *
 * ESTA FUNCIÓN SOLO COMPONE. Nunca envía, nunca persiste, nunca escribe en
 * `ai_replies`. La entrega la sigue haciendo `autonomousCommentReply` con la
 * respuesta privada por `comment_id` + `recordProactiveDm`, así que la bandeja
 * se ve exactamente igual que antes.
 *
 * Devuelve `null` ante CUALQUIER fallo y nunca lanza: quien llama cae al
 * redactor de siempre, y un comentario no se queda sin contestar por esto.
 *
 * Tres cosas que deliberadamente NO hace:
 *
 *   - No escribe `ai_replies`. `getStickyAgentId` y `escalate_after_messages`
 *     leen esa tabla: una respuesta a un comentario consumiría el presupuesto
 *     de escalado de los DMs de esa persona y podría secuestrar qué agente
 *     queda pegado a su conversación.
 *   - No resume la conversación. Reescribiría `ai_summary` del hilo de
 *     comentarios, que es lo que el runner lee después como contexto.
 *   - No pasa contexto de voz. Un comentario frío no debe poder disparar una
 *     llamada telefónica.
 *
 * No importa NADA de `instagram-agent/realtime.ts` — lo que ese módulo ya
 * calculó (pedido, producto, hilo, cliente) entra como `extraBrief`. Así no
 * hay ciclo de importación.
 */

/** Tope duro de un DM de Instagram. La respuesta privada por comentario es UN
 *  solo mensaje: no hay dónde partir el texto. Mismo recorte que aplica hoy
 *  `craftPersonalizedDM`. */
const IG_DM_MAX_CHARS = 950;

export interface SuperAgentInput {
  workspaceId: string;
  /** El agente que gobierna esta superficie (resolveIgAgent(..., 'comment')). */
  agentId: string;
  /** El contacto del canal de comentarios que acaba de comentar. */
  commentContactId: string;
  /** En qué red está su hilo de comentarios. */
  commentChannel?: 'ig_comment' | 'fb_comment' | 'tiktok_comment';
  /** Lo que escribió en el comentario. */
  commentText: string;
  /** Lo que el llamador ya averiguó (estado del pedido, cerebro del producto,
   *  hilo previo, ficha de cliente). Se anexa al system prompt en vez de
   *  recalcularse aquí. */
  extraBrief?: string | null;
}

export async function composeSuperAgentReply(
  db: SupabaseClient,
  input: SuperAgentInput,
): Promise<string | null> {
  try {
    const { data: agentRow } = await db
      .from('ai_agents')
      .select('*')
      .eq('id', input.agentId)
      .is('deleted_at', null)
      .maybeSingle();
    const agent = agentRow as AiAgent | null;
    if (!agent) return null;
    if (agent.provider !== 'anthropic') return null;

    const resolvedKey = await resolveAnthropicKey(db, {
      workspaceId: input.workspaceId,
      agentKeyEncrypted: agent.api_key_encrypted,
    });
    if (!resolvedKey) return null;
    const apiKey = resolvedKey.key;

    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', input.commentContactId)
      .maybeSingle();
    const contact = contactRow as Contact | null;
    if (!contact) return null;

    // El hilo de comentarios YA existe cuando esto corre: inbox-writer inserta
    // el mensaje y después dispara el router. Así que `loadContext` le da al
    // agente lo que ya se dijeron bajo ese post —incluidas nuestras propias
    // respuestas, que `recordProactiveDm` espeja ahí— sin trabajo extra.
    const { data: convRow } = await db
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .eq('channel', input.commentChannel ?? 'ig_comment')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const conversation = convRow as Conversation | null;
    if (!conversation) return null;

    const primaryContact = await loadPrimaryContact(db, contact);
    const productMatch = await detectInboundProduct(
      db,
      input.workspaceId,
      input.commentText,
    );

    const [shopifySnapshot, recentNotes, context, products, businessCurrency, igContext] =
      await Promise.all([
        enrichContactFromShopify(db, primaryContact).catch(() => null),
        loadRecentContactNotes(db, primaryContact.id),
        loadContext(db, conversation, 100),
        loadProductCatalog(db, agent, input.workspaceId, productMatch),
        resolveWorkspaceCurrency(db, input.workspaceId),
        loadInstagramContext(db, primaryContact.id).catch(() => null),
      ]);

    const shopify = await resolveShopifyContext(
      db,
      input.workspaceId,
      contact,
      productMatch,
    );
    if (shopify) {
      // Por `agentCan` y no por la columna suelta: con `permissions` cargado
      // (migración 164) manda ese. Leyendo la columna directo, un agente con
      // `permissions.crear_pedidos = true` cerraba pedidos por DM pero no al
      // contestar un comentario — la misma persona, dos respuestas distintas
      // según por dónde escribiera.
      shopify.canCreateOrders = toolEnabled(agent, 'crear_pedido');
      shopify.workspaceId = input.workspaceId;
      shopify.agentId = agent.id;
      shopify.contactId = primaryContact.id;
      // A propósito sin `conversationId`: el pedido nacería colgado del hilo de
      // COMENTARIOS, no de la conversación por DM donde seguirá la charla.
      // `tools.ts` tolera null; inventar un id sería peor.
      shopify.channel = 'instagram';
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
    system += `\n\n## Estás contestando un COMENTARIO\n${SURFACE_RULES}`;
    if (input.extraBrief?.trim()) {
      system += `\n\n## Lo que ya sabemos\n${input.extraBrief.trim()}`;
    }

    // La API exige que el primer turno sea del usuario. El comentario recién
    // insertado ya lo es, pero un hilo que arranque con una respuesta nuestra
    // (o vacío, si hubo una carrera con el insert) hay que sanearlo.
    let messages = context.messages.filter((m) => m.role === 'user' || m.content);
    while (messages.length && messages[0].role !== 'user') messages = messages.slice(1);
    const claudeMessages: Anthropic.MessageParam[] =
      messages.length > 0
        ? messages.map((m) => ({
            role: m.role,
            content: m.content || (m.role === 'user' ? 'Hola.' : ' '),
          }))
        : [{ role: 'user', content: input.commentText || 'Hola.' }];

    // Sin herramientas de Shopify no hay nada que ofrecerle al modelo, y
    // describírselas costaría tokens en vano. `voice` va en null a propósito.
    // Mismo constructor que el resto, en modo `comentario`: sin las de la
    // bandeja (ahi no hay un hilo que administrar). Era una lista propia de
    // tres herramientas y por eso se quedaba atras cada vez que el agente
    // aprendia algo nuevo.
    const tools = construirHerramientas({
      agent,
      hayContacto: Boolean(primaryContact.id),
      shopify,
      otherStore: null,
      voiceCtx: null,
      topeDescuento: 0,
      modo: 'comentario',
    });

    const maxChars = Math.min(agent.max_response_chars || 500, IG_DM_MAX_CHARS);
    const result = await runWithTools(getAnthropic(apiKey), {
      model: agent.model || MODELO_POR_DEFECTO,
      // Lo que el modelo piensa sale del mismo presupuesto que la
      // respuesta: sin aire se queda sin lugar para contestar.
      max_tokens:
        Math.max(64, Math.min(2048, Math.ceil(maxChars / 2))) +
        (reguladoPorEsfuerzo(agent.model || MODELO_POR_DEFECTO) ? 4000 : 0),
      system,
      messages: claudeMessages,
      tools,
      shopify,
      voice: null,
    });

    // Por la única puerta: acá se limpian los tics del modelo (los asteriscos
    // de Markdown llegaron a publicarse debajo de una foto) y se descarta lo
    // que no vale la pena mandar. Va DENTRO del compositor y no en cada
    // llamador a propósito: cuando era decisión del llamador, la superficie
    // nueva se olvidó y nadie se enteró hasta leer lo que se publicó.
    const text = salidaParaCliente(result.text);
    if (!text) return null;
    return text.length > maxChars ? recortarSalida(text, maxChars) : text;
  } catch (err) {
    console.error('[super-agent] compose falló, cae al redactor:', err);
    return null;
  }
}

/**
 * Reglas de la superficie. El agente reactivo está entrenado para una charla
 * por privado; esto es la PRIMERA respuesta a alguien que comentó en público y
 * puede que no espere un DM.
 */
const SURFACE_RULES = [
  'Esta persona comentó en una publicación y le estás escribiendo por privado por primera vez.',
  'Responde SU duda concreta, en una sola respuesta corta. Nada de saludos largos ni de presentarte.',
  'No prometas nada que no puedas verificar con tus herramientas.',
  'Si su duda ya está resuelta, ofrécele avanzar con la compra en una frase. Si no, no vendas.',
].join('\n');


