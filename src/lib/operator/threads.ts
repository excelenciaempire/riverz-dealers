/**
 * El hilo de conversación con el Operator.
 *
 * Se guardan sólo los turnos de texto —lo que preguntó la persona y lo que
 * contestó el Operator—, no las llamadas a herramientas ni lo que devolvieron.
 * Es deliberado: el estado de la cuenta cambia todo el tiempo, y arrastrar las
 * métricas de hace una hora dentro del contexto haría que el Operator conteste
 * con datos viejos en la vuelta siguiente. Si necesita el dato otra vez, lo
 * vuelve a pedir y lo trae fresco.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { titleFrom } from './prompt'

/** Cuántos turnos se le reenvían al modelo. Alcanza para seguir un hilo. */
const CONTEXT_TURNS = 20

export interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  created_at: string
}

export async function ensureThread(
  db: SupabaseClient,
  input: { threadId?: string | null; workspaceId: string; userId: string; firstText: string },
): Promise<string> {
  if (input.threadId) {
    const { data } = await db
      .from('operator_threads')
      .select('id')
      .eq('id', input.threadId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle()
    if (data) return (data as { id: string }).id
  }

  const { data, error } = await db
    .from('operator_threads')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      title: titleFrom(input.firstText),
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function loadMessages(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
): Promise<ThreadMessage[]> {
  const { data } = await db
    .from('operator_messages')
    .select('id, role, content, created_at')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(200)

  return ((data ?? []) as Array<{
    id: string
    role: 'user' | 'assistant'
    content: { text?: string }
    created_at: string
  }>).map((r) => ({
    id: r.id,
    role: r.role,
    text: r.content?.text ?? '',
    created_at: r.created_at,
  }))
}

/** Los últimos turnos, en el formato que espera el modelo. */
export function toAnthropic(messages: ThreadMessage[]): Anthropic.MessageParam[] {
  return messages
    .slice(-CONTEXT_TURNS)
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text }))
}

export async function appendMessage(
  db: SupabaseClient,
  input: {
    threadId: string
    workspaceId: string
    role: 'user' | 'assistant'
    text: string
    promptTokens?: number
    completionTokens?: number
  },
): Promise<void> {
  await db.from('operator_messages').insert({
    thread_id: input.threadId,
    workspace_id: input.workspaceId,
    role: input.role,
    content: { text: input.text },
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
  })
  await db
    .from('operator_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.threadId)
}

export async function loadActions(
  db: SupabaseClient,
  threadId: string,
  workspaceId: string,
) {
  const { data } = await db
    .from('operator_actions')
    .select('id, capability_key, args, risk, status, preview, result, created_at')
    .eq('thread_id', threadId)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  return data ?? []
}
