import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handleTemplateStatusUpdate } from './template-webhooks'

const reconcile = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('@/lib/automations/activation', () => ({ reconcileWorkspaceAutomationReadiness: reconcile }))

function fixture(rows: Array<{ workspace_id: string }>, error: { message: string } | null = null) {
  const query = { update: vi.fn(), eq: vi.fn(), select: vi.fn().mockResolvedValue({ data: rows, error }) }
  query.update.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  const from = vi.fn().mockReturnValue(query)
  return { db: { from } as unknown as SupabaseClient, from, query }
}

describe('template status readiness', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['APPROVED', 'PAUSED', 'DISABLED'])('rechecks the owning workspace after %s', async (event) => {
    const { db, query } = fixture([{ workspace_id: 'workspace-a' }, { workspace_id: 'workspace-a' }])
    await handleTemplateStatusUpdate(db, 'waba-a', { event, message_template_name: 'confirmation', message_template_language: 'es' })
    expect(query.eq).toHaveBeenCalledWith('waba_id', 'waba-a')
    expect(query.eq).toHaveBeenCalledWith('language', 'es')
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ meta_status: event }))
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(db, 'workspace-a')
  })

  it('does not touch other accounts when the WABA is missing', async () => {
    const { db, from } = fixture([])
    await handleTemplateStatusUpdate(db, '', { event: 'APPROVED', message_template_name: 'confirmation' })
    expect(from).not.toHaveBeenCalled()
  })

  it('does not activate after a failed status write', async () => {
    const { db } = fixture([], { message: 'write failed' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handleTemplateStatusUpdate(db, 'waba-a', { event: 'APPROVED', message_template_name: 'confirmation' })
    expect(reconcile).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('does not activate unrelated workspaces when no template matched', async () => {
    const { db } = fixture([])
    await handleTemplateStatusUpdate(db, 'waba-a', { event: 'APPROVED', message_template_name: 'missing' })
    expect(reconcile).not.toHaveBeenCalled()
  })
})
