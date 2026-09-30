import { describe,expect,it,vi } from 'vitest'
import { observeContext,observeOutcome,observeMessages,observeTool,publicToolStatus,saveTurnEvidence,withTurnEvidence } from './turn-evidence'
import type { SupabaseClient } from '@supabase/supabase-js'
const agent='11111111-1111-4111-8111-111111111111',rule='22222222-2222-4222-8222-222222222222'
describe('public turn evidence without private tool payloads',() => {
 it('keeps concurrent turns isolated and captures a rule version, not claimed application',async() => {
  const saved:unknown[]=[]
  await Promise.all([1,2].map(n => withTurnEvidence(async() => {
    observeContext(agent,[{ id:rule,live_revision:n,titulo:'Policy' }],[]);await Promise.resolve();observeTool('lookup_order','local','returned');observeOutcome('sent')
  },async state => { saved.push(state) })))
  expect(saved).toHaveLength(2)
  const states=saved as { evidence:{ rules:{ revision:number }[];tools:unknown[] } }[]
  expect(states.map(state => state.evidence.rules[0].revision).sort()).toEqual([1,2]);expect(states.every(state => state.evidence.tools.length===1)).toBe(true)
 })
 it('does not call a successful result a completed business action',() => {
  expect(publicToolStatus('{"ok":true,"confirmed":true,"order_id":"123"}')).toBe('returned')
  expect(publicToolStatus('{"ok":false,"error":"sk-secret"}')).toBe('reported_error')
  expect(publicToolStatus('{"ok":true,"estado":"pendiente_de_aprobacion"}')).toBe('approval_requested')
  expect(publicToolStatus('{"confirmed":false}')).toBe('unverified');expect(publicToolStatus('raw provider text')).toBe('unverified')
  expect(publicToolStatus(undefined as unknown as string)).toBe('unverified')
 })
 it('persists failed attempts and only whitelisted observations, never raw tool data',async() => {
  let snapshot=''
  await expect(withTurnEvidence(async() => { observeContext(agent,[],[{ kind:'message',id:rule }]);const tool=observeTool('update_order','local','started');if (tool) tool.status='threw';observeOutcome('failed',null,'provider_failed');throw new Error('private provider details') },async state => { snapshot=JSON.stringify(state) })).rejects.toThrow('private provider details')
  expect(snapshot).toContain('threw');expect(snapshot).not.toContain('private provider details');expect(snapshot).not.toContain('arguments')
 })
 it('bounds evidence without changing execution and treats missing revisions as unknown',async() => {
  await withTurnEvidence(async() => {
    observeContext(agent,[{ id:rule,titulo:'Policy' }],[])
    for (let n=0;n<101;n++) observeTool('lookup_order','local','returned')
    observeTool('Bearer secret','local','returned')
  },async state => { expect(state.evidence.tools).toHaveLength(100);expect(state.evidence.truncated).toBe(true);expect(state.evidence.rules[0].revision).toBeNull() })
 })
 it('preserves actual output references if a later part of the turn fails',async() => {
  await withTurnEvidence(async() => {
    observeTool('lookup_order','local','returned');observeMessages([agent,rule]);observeOutcome('sent',agent);observeOutcome('failed',null,'provider_failed')
  },async state => { expect(state.status).toBe('failed');expect(state.messageIds).toEqual([agent,rule]);expect(state.messageId).toBe(agent) })
 })
 it('never retries a business action when evidence storage fails',async() => {
  const db={ rpc:vi.fn().mockRejectedValue(new Error('storage unavailable')) } as unknown as SupabaseClient
  const error=vi.spyOn(console,'error').mockImplementation(() => {})
  try { await withTurnEvidence(async() => { observeTool('lookup_order','local','returned') },state => saveTurnEvidence(db,{ workspaceId:agent,conversationId:rule,inboundId:null },state));expect(db.rpc).toHaveBeenCalledTimes(1) } finally { error.mockRestore() }
 })
})
