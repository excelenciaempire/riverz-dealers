import {
  briefDeQueHabla,
  puedeAportarContexto,
} from '@/lib/channels/de-que-habla';
import {
  briefDePublicacion,
  REGLAS_COMENTARIO_PUBLICO,
} from '@/lib/channels/publicacion';
import { loadPrimaryContact } from '@/lib/contacts/dedupe';
import { enrichContactFromShopify } from '@/lib/contacts/enrich';
import { loadInstagramContext } from '@/lib/instagram-agent/agent-context';
import {
  instruccionPara,
  mereceRespuesta,
} from '@/lib/instagram-agent/merece-respuesta';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import type { Contact, Conversation } from '@/types';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropic } from './anthropic-client';
import { MODELO_POR_DEFECTO, reguladoPorEsfuerzo } from './esfuerzo';
import { ESTILO_HUMANO, humanizarTexto } from './estilo-humano';
import { cargarReglas, reglasATexto } from './guidance';
import { claveRechazada, resolveAnthropicKey } from './platform-key';
import { resolverRegistro } from './registro-rioplatense';
import {
  buildSystemPrompt,
  construirHerramientas,
  detectInboundProduct,
  getStickyAgentId,
  loadContext,
  loadProductCatalog,
  loadRecentContactNotes,
  paginaDeLaConversacion,
  pickAgent,
  resolveOtherStore,
  resolveShopifyContext,
} from './runner';
import { runWithTools } from './tools';
import type { AiAgent } from './types';
import { MIN_DEBOUNCE_SECONDS } from './types';

/** El borrador lo escribe Sonnet aunque el agente use otro modelo: ver la
 *  nota en la llamada. */
const MODELO_BORRADOR = 'claude-sonnet-5';

/** Salto de línea, con nombre: estas listas se leen mejor así. */
const SALTO = `
`;

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
  | 'sin_saldo'
  | 'sin_contacto'
  | 'vacio'
  | 'fallo';

export interface BorradorResultado {
  text: string | null;
  error: BorradorError | null;
}

export async function componerBorrador(
  db: SupabaseClient,
  input: { workspaceId: string; conversation: Conversation }
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
      (ultimoRow as { content_text?: string | null } | null)?.content_text ?? ''
    );

    const productMatch = await detectInboundProduct(
      db,
      input.workspaceId,
      ultimoCliente,
      // El borrador se arma con lo mismo que ve el agente que contesta solo:
      // en el chat web, la ficha en la que está parado quien pregunta.
      conversation.channel === 'webchat'
        ? ((await paginaDeLaConversacion(db, conversation.id))?.url ?? null)
        : null
    );
    // Mismo arbitraje que cuando contesta solo: el agente que ya venía
    // atendiendo este hilo, y si no el que corresponde al canal y al producto.
    const stickyAgentId = await getStickyAgentId(db, conversation.id);
    const agent = await agenteParaBorrador(
      db,
      input.workspaceId,
      conversation.channel,
      {
        productMatch,
        stickyAgentId,
        inboundText: ultimoCliente,
      }
    );

    // Con qué se paga esto, y con qué se reintenta.
    //
    // Un botón que alguien aprieta no puede morir porque el pagador de turno
    // se quedó sin saldo: pasó en producción —la cuenta de Anthropic llegó a
    // cero y el borrador contestaba "no se pudo generar" sin decir por qué—.
    // Se prueban en orden y sólo se pasa a la siguiente cuando el problema ES
    // la clave; un 429 o un error del modelo no mejora cambiando de pagador.
    const claves: string[] = [];
    const resolvedKey = await resolveAnthropicKey(db, {
      workspaceId: input.workspaceId,
      agentKeyEncrypted: agent.api_key_encrypted,
    });
    if (resolvedKey?.key) claves.push(resolvedKey.key);
    if (resolvedKey?.source !== 'platform') {
      const plataforma = await resolveAnthropicKey(db, {
        workspaceId: input.workspaceId,
      });
      if (plataforma?.key && !claves.includes(plataforma.key))
        claves.push(plataforma.key);
    }
    const delServidor = process.env.ANTHROPIC_API_KEY;
    if (delServidor && !claves.includes(delServidor)) claves.push(delServidor);
    if (claves.length === 0) return { text: null, error: 'sin_clave' };

    const primaryContact = await loadPrimaryContact(db, contact);
    const [
      shopifySnapshot,
      recentNotes,
      context,
      products,
      businessCurrency,
      igContext,
    ] = await Promise.all([
      enrichContactFromShopify(db, primaryContact).catch(() => null),
      loadRecentContactNotes(db, primaryContact.id),
      loadContext(db, conversation, agent.context_messages || 30),
      loadProductCatalog(db, agent, input.workspaceId, productMatch),
      resolveWorkspaceCurrency(db, input.workspaceId),
      contextoDeLaPublicacion(
        db,
        input.workspaceId,
        conversation,
        contact.id,
        ultimoCliente
      ).catch(() => null),
    ]);

    // El contexto de Shopify entra para que el prompt tenga la ficha del
    // cliente y el precio real, pero SIN permiso de crear nada.
    const shopify = await resolveShopifyContext(
      db,
      input.workspaceId,
      contact,
      productMatch
    );
    // La tienda que no es Shopify: sin esto el botón de borrador no podía
    // consultar el pedido de un comercio de Tiendanube o Woo, y quien atiende
    // se quedaba escribiéndolo a mano.
    const otherStore = await resolveOtherStore(
      db,
      input.workspaceId,
      Boolean(shopify),
      primaryContact
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
      // Las reglas del comercio también en el borrador: lo que el agente no
      // puede prometer solo, tampoco se lo puede sugerir a una persona para
      // que lo mande con un clic.
      reglasATexto(await cargarReglas(db, input.workspaceId, agent.id)),
      // El borrador se lo va a mandar una persona del equipo: tiene que sonar
      // igual que lo que manda el agente solo, o el hilo cambia de trato a la
      // mitad.
      await resolverRegistro({
        db,
        workspaceId: input.workspaceId,
        idioma: agent.language,
        contact,
        primaryContact,
      })
    );
    system += `\n\n## Esto es un BORRADOR\n${REGLAS_BORRADOR}`;
    system += `\n${reglasDeSuperficie(conversation.channel)}`;

    // La API exige que el primer turno sea del usuario.
    let messages = context.messages.filter(
      (m) => m.role === 'user' || m.content
    );
    while (messages.length && messages[0].role !== 'user')
      messages = messages.slice(1);
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
    let result: Awaited<ReturnType<typeof runWithTools>> | null = null;
    let ultimoFallo: unknown = null;
    for (const clave of claves) {
      try {
        result = await runWithTools(
          getAnthropic(clave, {
            db,
            workspaceId: input.workspaceId,
            concepto: 'ia_asistencia',
            origenDeLaClave:
              clave === resolvedKey?.key ? resolvedKey.source : 'platform',
          }),
          {
            // Sonnet, no el modelo del agente.
            //
            // El agente contesta miles de mensajes solo y por eso corre en Haiku,
            // que es la decisión correcta ahí. Acá es una llamada suelta, a pedido y
            // que alguien va a leer antes de mandar: lo que importa es que suene a
            // persona y que respete lo que NO hay que hacer —no vender en un
            // comentario, no pedir datos en público, no explicar de más—. Medido
            // sobre las conversaciones reales de un comercio, Haiku se saltaba esas
            // reglas una de cada dos veces y contestaba "Habla mucho" con un folleto
            // de ingredientes.
            model: MODELO_BORRADOR,
            // Lo que el modelo piensa sale del mismo presupuesto que la
            // respuesta: sin aire se queda sin lugar para contestar.
            max_tokens:
              Math.max(64, Math.min(2048, Math.ceil(maxChars / 2))) +
              (reguladoPorEsfuerzo(MODELO_BORRADOR) ? 4000 : 0),
            system,
            messages: claudeMessages,
            // El mismo constructor que usa el agente cuando contesta solo, en
            // modo `borrador`: de lectura. Antes era una lista aparte con UNA
            // herramienta, asi que cada capacidad nueva -- buscar en internet,
            // ver la ficha de quien escribe -- nacia sin llegar nunca aca.
            tools: construirHerramientas({
              agent,
              hayContacto: Boolean(primaryContact.id),
              shopify,
              otherStore,
              voiceCtx: null,
              topeDescuento: 0,
              modo: 'borrador',
            }),
            shopify,
            voice: null,
          }
        );
        break;
      } catch (err) {
        ultimoFallo = err;
        if (claveRechazada(err)) continue;
        throw err;
      }
    }
    if (!result) {
      if (claveRechazada(ultimoFallo))
        return { text: null, error: 'sin_saldo' };
      throw ultimoFallo ?? new Error('ninguna clave sirvió');
    }

    // A la billetera, a lo que costó. El borrador ya frenaba sin saldo y no
    // descontaba nada: es una llamada a Sonnet con herramientas, no barata.

    const text = humanizarTexto(result.text);
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
  contactId: string,
  /** Lo último que dijo la persona: de ahí sale con qué reglas se contesta. */
  ultimoCliente: string
): Promise<string | null> {
  void workspaceId;
  const partes: string[] = [];

  // De qué post/video cuelga el comentario (TikTok trae además lo que se
  // dice en el video).
  const publicacion = await briefDePublicacion(db, conversation).catch(
    () => null
  );
  if (publicacion) partes.push(publicacion);

  // Las mismas reglas que sigue el agente cuando contesta solo. Sin esto, el
  // botón de generar respuesta redactaba una cosa y la automatización otra —
  // y era el borrador el que ofrecía publicar "no tenemos aprobación ANMAT".
  const motivo = ultimoCliente ? mereceRespuesta(ultimoCliente) : null;
  if (motivo) partes.push(instruccionPara(motivo));

  // Y en el resto de canales: la publicación de Mercado Libre sobre la que
  // preguntan, o el anuncio por el que escribieron. Quien redacta a mano
  // necesita saberlo tanto como el agente.
  if (puedeAportarContexto(conversation.channel)) {
    const de = await briefDeQueHabla(db, conversation).catch(() => null);
    if (de) partes.push(de);
  }

  // Quién es esta persona en Instagram ("un solo cerebro"): sirve tanto en el
  // DM como debajo del post.
  if (
    conversation.channel === 'instagram' ||
    conversation.channel === 'ig_comment'
  ) {
    const ig = await loadInstagramContext(db, contactId).catch(() => null);
    if (ig) partes.push(ig);
  }
  return partes.length ? partes.join(SALTO + SALTO) : null;
}

/**
 * Cada canal tiene su forma. Un comentario público no es un DM, un correo no
 * es un chat, y Mercado Libre tiene reglas propias que si se rompen le cuestan
 * la publicación al vendedor. Antes el borrador salía siempre con forma de
 * mensaje de WhatsApp, en los once canales.
 */
function reglasDeSuperficie(channel: Conversation['channel']): string {
  switch (channel) {
    case 'ig_comment':
    case 'fb_comment':
    case 'tiktok_comment':
      return REGLAS_COMENTARIO_PUBLICO;
    case 'gmail':
    case 'outlook':
      return [
        'Esto es un correo: puede ser más largo que un chat, con párrafos cortos y separados.',
        'No inventes asunto ni firma; escribe sólo el cuerpo, como lo escribiría una persona del equipo.',
      ].join(SALTO);
    case 'mercadolibre':
      return [
        'Esto va por Mercado Libre: está prohibido incluir teléfonos, correos, enlaces externos o formas de pago fuera de la plataforma antes de la venta.',
        'Responde la pregunta sobre la publicación de forma directa y corta.',
      ].join(SALTO);
    case 'webchat':
      return 'Esto es el chat de la web: la persona está mirando la pantalla ahora mismo. Respuesta corta y directa.';
    default:
      return 'Esto es un mensaje privado de chat: tono cercano, frases cortas, una idea por mensaje.';
  }
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
  }
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
  return redactorGenerico(
    workspaceId,
    (ws as { name?: string } | null)?.name ?? null
  );
}

/** El agente que no existe: sólo lo suficiente para armar el prompt. Nunca se
 *  guarda ni se muestra en ningún lado. */
function redactorGenerico(
  workspaceId: string,
  nombreDelComercio: string | null
): AiAgent {
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
    model: MODELO_POR_DEFECTO,
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
  'Contesta SÓLO lo que dijo. No agregues beneficios, ingredientes, precios, promociones ni explicaciones que nadie pidió: si preguntó una cosa, se contesta esa cosa.',
  'Escribe como una persona del equipo, no como atención al cliente. Prohibido: "estoy aquí para ayudarte", "un agente del equipo", "no dudes en", "quedamos atentos", y preguntar "en qué puedo ayudarte" cuando ya se sabe de qué se está hablando.',
  'No cites ni repitas lo que escribió la persona ("veo que escribiste…", "entiendo que decís…"): contesta directo.',
  'Si su mensaje no es una pregunta (una opinión, una queja, un elogio, un emoji) no preguntes de qué habla: responde como respondería una persona, en una línea, y listo.',
  'Corto. Si alcanza con una frase, una frase. No hace falta cerrar siempre con una pregunta.',
  'Mantén el mismo trato que viene usando la conversación (de tú o de vos) y no lo mezcles dentro del mismo mensaje.',
  'Si preguntan si eres un bot o una IA, no discutas eso: contesta en una línea lo que necesiten ahora ("contame qué necesitas y te ayudo"). Nunca escribas "no soy una IA" ni "soy una persona".',
  'Nunca te presentes ni te pongas nombre: nada de "soy X del equipo". Se contesta y ya.',
  'Escribes SIEMPRE como la tienda. Nunca escribas como si fueras el cliente ni repitas su mensaje en primera persona.',
  'No confirmes un ingrediente, un precio ni una promesa que no esté en la ficha del producto, ni aunque la persona lo cite del video o lo dé por hecho. Si no está en la ficha, no lo repitas: se dice lo que sí sabes.',
  'No uses el nombre de la marca como si fuera tu nombre.',
  'Nada de "entiendo tu frustración", "entiendo tu preocupación" ni consuelos de manual: se va directo a lo que se puede decir.',
  'No repitas su nombre ni uses su usuario de la red social como nombre.',
  'Sin emojis, salvo que la persona haya usado uno: en ese caso, uno solo. Un emoji en cada respuesta es lo que delata a un robot.',
  'Si comenta algo del video o del producto (un ingrediente, la edad, el sol, la piel) eso ES del negocio: respóndelo con lo que sabes, no lo trates como fuera de tema.',
  'Nunca escribas que te falta contexto, que no entiendes la conversación previa, que eres una IA, ni que sólo puedes ayudar con productos y pedidos.',
  'Cuando el comentario sea demasiado ambiguo para saber qué quiso decir (una palabra suelta, una sigla, un emoji, algo sin contexto) NO adivines ni te inventes una interpretación: contesta algo general y corto, del tipo "contame qué necesitas y te ayudo" o "¿qué te gustaría saber?", y nada más. Una respuesta genérica es mejor que una respuesta a una pregunta que nadie hizo.',
  'Nada de encabezados, opciones numeradas ni notas para quien atiende: sólo el mensaje.',
  'Sin espacios para completar ni corchetes. Si un dato no lo sabes, no lo menciones.',
  ESTILO_HUMANO,
].join('\n');
