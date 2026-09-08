import { getAnthropic } from '@/lib/ai/anthropic-client';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './admin-client';

/**
 * Classify a customer's free-text reply into one of the declared intents
 * (declared on the flows `ai_intent` node). Returns the matched
 * intent_key, or null if no intent matched with enough confidence.
 *
 * Uses the workspace's active AI agent for prompt config + API key when
 * one exists; falls back to the server-level ANTHROPIC_API_KEY otherwise.
 * Never throws on AI failures — the caller routes to fallback_next_key.
 */
export async function classifyIntent(args: {
  workspaceId: string;
  message: string;
  intents: Array<{ intent_key: string; description: string }>;
}): Promise<string | null> {
  if (args.intents.length === 0) return null;
  const db = supabaseAdmin();

  // Sin saldo no se clasifica: el flujo sale por su rama de respaldo, que es
  // exactamente lo que hace cuando el modelo no entiende.
  if (!(await puedeUsarIa(db, args.workspaceId))) return null;

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

  const model = row?.model || 'claude-haiku-4-5-20251001';
  const optionList = args.intents
    .map((i) => `- ${i.intent_key}: ${i.description}`)
    .join('\n');

  const client = getAnthropic(apiKey, {
    db,
    workspaceId: args.workspaceId,
    concepto: 'ia_clasificacion',
    origenDeLaClave: resolved?.source,
  });
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 32,
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
