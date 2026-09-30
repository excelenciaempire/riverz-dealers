import type { TFn } from '@/lib/i18n/translate'

/** Check immediately before sending, after the team has seen the composing lease. */
export async function checkReplyCollision(conversationId: string, t: TFn, fetcher: typeof fetch = fetch,
  confirm: (message: string) => boolean = message => window.confirm(message)): Promise<void> {
  let writers: string[]
  try {
    const response = await fetcher(`/api/conversations/${conversationId}/collaboration`, { cache: 'no-store' })
    if (!response.ok) throw new Error('presence_unavailable')
    const body = await response.json()
    if (!Array.isArray(body.presence)) throw new Error('presence_unavailable')
    writers = body.presence.filter((p: { composing?: boolean; name?: string }) => p.composing === true && typeof p.name === 'string')
      .map((p: { name: string }) => p.name)
  } catch {
    if (!confirm(t('inbox.teamPresenceUnavailable'))) throw new Error('reply_collaboration_cancelled')
    return
  }
  if (writers.length && !confirm(t('inbox.teamSendAnyway', { names: writers.join(', ') }))) throw new Error('reply_collaboration_cancelled')
}
