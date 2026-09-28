import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reserva inmutable de un turno de IA.
 *
 * Los webhooks, el sondeo del canal y el interruptor "Responde la IA" pueden
 * despertar el mismo mensaje casi al mismo tiempo. Una PK determinística en el
 * registro de respuestas convierte esas carreras en un solo ganador antes de
 * que cualquiera de ellos llame al proveedor del canal.
 */
export async function claimAiReplyTurn(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    conversationId: string;
    inboundMessageId: string;
    agentId: string;
  },
): Promise<boolean> {
  const { error } = await db.from('ai_replies').insert({
    id: aiReplyClaimId(args.workspaceId, args.inboundMessageId),
    agent_id: args.agentId,
    workspace_id: args.workspaceId,
    conversation_id: args.conversationId,
    message_id: args.inboundMessageId,
    status: 'skipped',
    skip_reason: 'dispatch_claim',
    // La fila es un candado técnico, no actividad del agente. La fecha fija la
    // deja fuera de métricas, costos y del "por qué no contestó" del hilo.
    created_at: '1970-01-01T00:00:00.000Z',
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

/** UUID estable de la reserva; vive en ai_replies y no exige esquema nuevo. */
export function aiReplyClaimId(
  workspaceId: string,
  inboundMessageId: string,
): string {
  return stableUuid(['ai-reply-claim-v1', workspaceId, inboundMessageId]);
}

/** UUID estable para reservar cada burbuja antes de enviarla al canal. */
export function aiTextMessageId(
  conversationId: string,
  inboundMessageId: string,
  part: number | 'deterministic',
): string {
  return stableUuid([
    'ai-text-message-v1',
    conversationId,
    inboundMessageId,
    part,
  ]);
}

function stableUuid(parts: unknown[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
