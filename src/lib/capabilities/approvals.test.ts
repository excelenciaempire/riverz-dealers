import { describe,it,expect,vi,beforeEach } from 'vitest'
import type { CapabilityContext } from './types'
const decide=vi.hoisted(() => vi.fn())
vi.mock('@/lib/approvals/resolve',() => ({ decidir:decide }))
import { APPROVAL_CAPABILITIES } from './approvals'
const owner='11111111-1111-4111-8111-111111111111', impostor='22222222-2222-4222-8222-222222222222'
const run=APPROVAL_CAPABILITIES.find(cap => cap.key === 'aprobaciones.decidir')!.run
beforeEach(() => decide.mockReset().mockResolvedValue({ ok:true }))
describe('approval identity across authenticated adapters',() => {
  it('uses the verified MCP issuer and ignores a tool argument claiming another identity',async () => {
    const ctx={ db:{},workspaceId:'ws',actor:{ type:'mcp',id:'key label',userId:owner } } as CapabilityContext
    await run(ctx,{ approval_id:'approval',aprobar:true,decided_by:impostor })
    expect(decide).toHaveBeenCalledWith({},expect.objectContaining({ decidedBy:owner,workspaceId:'ws' }))
  })
  it('does not let an arbitrary MCP key label impersonate an administrator UUID',async () => {
    const ctx={ db:{},workspaceId:'ws',actor:{ type:'mcp',id:owner } } as CapabilityContext
    await run(ctx,{ approval_id:'approval',aprobar:true })
    expect(decide).toHaveBeenCalledWith({},expect.objectContaining({ decidedBy:null }))
  })
  it('preserves the authenticated operator user identity',async () => {
    const ctx={ db:{},workspaceId:'ws',actor:{ type:'operator',id:owner } } as CapabilityContext
    await run(ctx,{ approval_id:'approval',aprobar:false })
    expect(decide).toHaveBeenCalledWith({},expect.objectContaining({ decidedBy:owner,decision:'rechazada' }))
  })
})
