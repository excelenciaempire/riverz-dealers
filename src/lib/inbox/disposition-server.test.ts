import { describe,expect,it,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only',() => ({}))
import { assertInboxCaseCanSend,inboxCaseIsSpam } from './disposition-server'
function fixture(data:unknown,error:unknown=null) {
  const q={ select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({ data,error }) }
  return { q,db:{ from:vi.fn(() => q) } as unknown as SupabaseClient }
}
describe('fresh case send guard',() => {
  it('uses both workspace and live case, and allows restored cases',async() => {
    const { db,q }=fixture({ is_spam:false })
    await expect(assertInboxCaseCanSend(db,'ws','case')).resolves.toBeUndefined()
    expect(q.eq.mock.calls).toEqual([['workspace_id','ws'],['id','case']])
    expect(q.is).toHaveBeenCalledWith('deleted_at',null)
  })
  it('refuses spam and unavailable state before any send',async() => {
    await expect(assertInboxCaseCanSend(fixture({ is_spam:true }).db,'ws','case')).rejects.toMatchObject({ code:'inbox_case_spam' })
    for (const f of [fixture(null),fixture({}),fixture({ is_spam:false },{ message:'failed' })]) await expect(inboxCaseIsSpam(f.db,'ws','case')).rejects.toThrow('inbox_disposition_unavailable')
  })
})
