import { describe,expect,it } from 'vitest'
import { guidanceCreateInput,guidanceSnapshot,guidanceVersionInput } from './guidance-versions'
describe('strict rule version contracts',() => {
  const snapshot={ titulo:' Delivery ',hacer:' Verified dates ',cuando:'' }
  it('normalizes editable content but never accepts scope, billing or execution overrides',() => {
    expect(guidanceSnapshot(snapshot)).toEqual({ titulo:'Delivery',hacer:'Verified dates',cuando:null })
    for (const body of [{ ...snapshot,activa:true },{ ...snapshot,workspace_id:'other' },{ ...snapshot,hacer:'' },{ ...snapshot,titulo:'x'.repeat(121) },{ ...snapshot,cuando:{} }]) expect(guidanceSnapshot(body)).toBeNull()
  })
  it('binds every mutation to exact live and draft versions',() => {
    expect(guidanceVersionInput({ action:'save',live_revision:2,draft_revision:0,snapshot })).toMatchObject({ action:'save',live_revision:2,draft_revision:0 })
    for (const body of [{ action:'publish',live_revision:2,draft_revision:0 },{ action:'publish',live_revision:2.5,draft_revision:1 },{ action:'rollback',live_revision:1e20,target_revision:1 },{ action:'discard',draft_revision:1,actor_id:'owner' },{ action:'test',live_revision:1 }]) expect(guidanceVersionInput(body)).toBeNull()
  })
  it('preserves legacy active creation while allowing an explicit new draft',() => {
    expect(guidanceCreateInput(snapshot)?.draft).toBe(false)
    expect(guidanceCreateInput({ ...snapshot,draft:true })?.draft).toBe(true)
    expect(guidanceCreateInput({ ...snapshot,agent_id:'foreign-shape' })).toBeNull()
    expect(guidanceCreateInput({ ...snapshot,workspace_id:'other' })).toBeNull()
  })
})
