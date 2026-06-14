import type { SupabaseClient } from '@supabase/supabase-js'

const OPT_OUT_KEYWORDS = ['STOP', 'BAJA', 'CANCELAR', 'UNSUBSCRIBE', 'CANCEL', 'SAIR']
const OPT_IN_KEYWORDS = ['SUSCRIBIR', 'SUBSCRIBE', 'ALTA', 'START']

function normalize(text: string): string {
  return text.trim().toUpperCase()
}

function matchesAny(text: string, words: string[]): boolean {
  const t = normalize(text)
  if (!t) return false
  const pattern = new RegExp(`\\b(${words.join('|')})\\b`)
  return pattern.test(t)
}

export function isOptOutKeyword(text: string): boolean {
  return matchesAny(text, OPT_OUT_KEYWORDS)
}

export function isOptInKeyword(text: string): boolean {
  return matchesAny(text, OPT_IN_KEYWORDS)
}

export async function markOptedOut(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  reason: string,
): Promise<void> {
  await db
    .from('contacts')
    .update({
      opted_out: true,
      opted_out_at: new Date().toISOString(),
      opted_out_reason: reason,
    })
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
}

export async function markOptedIn(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<void> {
  await db
    .from('contacts')
    .update({
      opted_out: false,
      opted_out_at: null,
      opted_out_reason: null,
    })
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
}

export async function isOptedOut(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<boolean> {
  const { data } = await db
    .from('contacts')
    .select('opted_out')
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return Boolean((data as { opted_out?: boolean } | null)?.opted_out)
}
