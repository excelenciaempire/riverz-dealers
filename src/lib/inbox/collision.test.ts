import { describe, expect, it, vi } from 'vitest'
import { checkReplyCollision } from './collision'
import { translate, type TFn } from '@/lib/i18n/translate'
const t: TFn = (key, vars) => translate('en', key, vars)
describe('reply collision review', () => {
  it('does not interrupt a send when teammates are only viewing the case', async () => {
    const confirm = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(Response.json({ presence: [{ name: 'Ana', composing: false }] }))
    await checkReplyCollision('case-id', t, fetcher, confirm)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('stops before sending when another author is composing and the user cancels', async () => {
    const confirm = vi.fn().mockReturnValue(false)
    const fetcher = vi.fn().mockResolvedValue(Response.json({ presence: [{ name: 'Ana', composing: true }] }))
    await expect(checkReplyCollision('case-id', t, fetcher, confirm)).rejects.toThrow('reply_collaboration_cancelled')
    expect(confirm).toHaveBeenCalledWith(t('inbox.teamSendAnyway', { names: 'Ana' }))
  })
  it('requires explicit review when presence is unavailable', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    await expect(checkReplyCollision('case-id', t, fetcher, () => false)).rejects.toThrow('reply_collaboration_cancelled')
  })
})
