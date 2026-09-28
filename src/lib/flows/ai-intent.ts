import { getAnthropic } from '@/lib/ai/anthropic-client';
import { esfuerzo } from '@/lib/ai/esfuerzo';
import { hayJev, preguntarJev, type RespuestaChoice } from '@/lib/ai/jev';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './admin-client';

/**
 * Classify a customer's free-text reply into one of the declared intents
 * (declared on the flows `ai_intent` node). Returns the matched
 * intent_key, or null if no intent matched with enough confidence.
 *
 * Con `TYPESAFE_API_KEY` decide Jev: es una elección entre opciones cerradas,
 * que es exactamente lo que hace, y devuelve además cuánto se inclina por la
 * ganadora. Sin llave, o si Jev no contesta, Haiku como siempre.
 *
 * Never throws on AI failures — the caller routes to fallback_next_key.
 */
export async function classifyIntent(args: {
  workspaceId: string;
  conversationId?: string | null;
  message: string;
  intents: Array<{ intent_key: string; description: string }>;
}): Promise<string | null> {
  if (args.intents.length === 0) return null;
  const db = supabaseAdmin();

  // Sin saldo no se clasifica: el flujo sale por su rama de respaldo, que es
  // exactamente lo que hace cuando el modelo no entiende.
  if (!(await puedeUsarIa(db, args.workspaceId))) return null;

  if (hayJev()) {
    const resultado = await preguntarJev({
      db,
      workspaceId: args.workspaceId,
      concepto: 'ia_clasificacion',
      detalle: { para: 'flujo_intencion', conversacion: args.conversationId },
      state: { mensaje_del_cliente: args.message.slice(0, 1500) },
      questions: { intencion: preguntaDeIntencion(args.intents) },
    });
    // Si Jev no contestó (caído, fusible abierto), sigue Haiku como siempre.
    if (resultado)
      return intencionDesdeJev(resultado.answers.intencion, args.intents);
  }

  const { data: agent } = await db
    .from('ai_agents')
    .select('model, api_key_encrypted')
    .eq('workspace_id', args.workspaceId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = agent as {
    model: string;
    api_key_encrypted: string | null;
  } | null;

  const resolved = await resolveAnthropicKey(db, {
    workspaceId: args.workspaceId,
    agentKeyEncrypted: row?.api_key_encrypted,
  });
  const apiKey = resolved?.key;
  if (!apiKey) return null;

  const model = row?.model || 'claude-sonnet-5-5';
  const optionList = args.intents
    .map((i) => `- ${i.intent_key}: ${i.description}`)
    .join('\n');

  const client = getAnthropic(apiKey, {
    db,
    workspaceId: args.workspaceId,
    concepto: 'ia_clasificacion',
    detalle: { para: 'flujo_intencion', conversacion: args.conversationId },
    origenDeLaClave: resolved?.source,
  });
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 32,
      ...esfuerzo(model),
      system:
        'Clasificás un mensaje del cliente en una de las categorías que se te dan. ' +
        'Responde SOLO con el intent_key exacto, sin explicación. ' +
        'Si ninguno encaja claramente, responde exactamente: none',
      messages: [
        {
          role: 'user',
          content: `Opciones:\n${optionList}\n\nMensaje del cliente:\n${args.message}\n\nintent_key:`,
        },
      ],
    });

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toLowerCase();
    if (!raw || raw === 'none') return null;
    const match = args.intents.find((i) => i.intent_key.toLowerCase() === raw);
    return match?.intent_key ?? null;
  } catch {
    return null;
  }
}

/**
 * Las opciones del nodo tal cual, más "ninguna". Sin esa salida, Jev tiene que
 * elegir una intención aunque el mensaje no sea ninguna, y el flujo se va por
 * una rama que no corresponde en vez de por la de respaldo.
 */
const NINGUNA = '__ninguna__';

export function preguntaDeIntencion(
  intents: Array<{ intent_key: string; description: string }>
) {
  const criteria: Record<string, string | null> = {};
  for (const i of intents) criteria[i.intent_key] = i.description || null;
  criteria[NINGUNA] =
    'El mensaje no encaja claramente con ninguna de las otras opciones.';
  return {
    type: 'choice' as const,
    instructions:
      '¿Cuál de estas intenciones expresa `mensaje_del_cliente`? Elige la que mejor describe lo que la persona quiere.',
    criteria,
  };
}

/**
 * Con qué seguridad hay que quedarse con la elegida. Por debajo, se va por la
 * rama de respaldo, como cuando Haiku decía "none". Es una decisión de flujo
 * (mandar a la persona por un camino), no un aviso: alcanza con que la ganadora
 * se despegue de las demás.
 */
const CONFIANZA_MINIMA = 0.5;

/** Pura, para probarla sin red. */
export function intencionDesdeJev(
  r: RespuestaChoice<string>,
  intents: Array<{ intent_key: string }>
): string | null {
  if (r.choice === NINGUNA || r.confidence < CONFIANZA_MINIMA) return null;
  return intents.find((i) => i.intent_key === r.choice)?.intent_key ?? null;
}
