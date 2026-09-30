import { describe,it,expect } from 'vitest'
import { caseOrderAction,orderPreviewInput } from './order-action-contract'
describe('bounded human order requests',() => {
  it('requires an explicit full or partial refund with a reason and refuses malformed full-refund fallbacks',() => {
    expect(caseOrderAction({ type:'refund',amount:null,reason:' Full refund ' })).toEqual({ type:'refund',amount:null,reason:'Full refund' })
    expect(caseOrderAction({ type:'refund',amount:25,reason:'Damage' })).toMatchObject({ amount:25 })
    for (const amount of [undefined,'25',0,-25,Infinity,NaN,0.0000001]) expect(caseOrderAction({ type:'refund',amount,reason:'Damage' })).toBeNull()
    expect(caseOrderAction({ type:'cancel',reason:'Customer requested',amount:100 })).toBeNull()
    expect(caseOrderAction({ type:'cancel',reason:'' })).toBeNull()
  })
  it('accepts only the reviewed local order and operation IDs, not arbitrary provider targets',() => {
    const v={ id:'11111111-1111-4111-8111-111111111111',order_id:'22222222-2222-4222-8222-222222222222',action:{ type:'cancel',reason:'Customer requested' } }
    expect(orderPreviewInput(v)).not.toBeNull()
    expect(orderPreviewInput({ ...v,shop_domain:'foreign.myshopify.com' })).toBeNull()
    expect(orderPreviewInput({ ...v,order_id:'100' })).toBeNull()
  })
})
