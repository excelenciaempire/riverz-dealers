import { describe,it,expect } from 'vitest'
import { caseOrderAction,orderPreviewInput,sameCaseOrderAction } from './order-action-contract'
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
  it('accepts bounded shipping fields and compares nested actions independently of JSONB ordering',() => {
    const address={ address1:'20 Main St',address2:'',city:'Austin',province:'Texas',zip:'78701',countryCode:'US' }
    const action={ type:'address',reason:'Customer requested',address }
    expect(caseOrderAction(action)).toEqual(action)
    const reversed=Object.fromEntries(Object.entries(address).reverse())
    expect(sameCaseOrderAction({ address:reversed,reason:action.reason,type:'address' },action)).toBe(true)
    expect(sameCaseOrderAction({ ...action,address:{ ...address,address1:'Other St' } },action)).toBe(false)
    for (const patch of [{ city:'' },{ countryCode:'ZZ' },{ phone:'+15125550100' },{ address1:'A'.repeat(256) }]) {
      expect(caseOrderAction({ ...action,address:{ ...address,...patch } })).toBeNull()
    }
  })
  it('accepts only explicit bounded item changes and makes nested retries independent of item order',() => {
    const a={ type:'items',reason:'Size change',items:[{ variantId:'222',quantity:1,free:false },{ variantId:'111',quantity:1,free:true }] }
    expect(caseOrderAction(a)).toMatchObject({ type:'items',items:[{ variantId:'111',quantity:1,free:true },{ variantId:'222',quantity:1,free:false }] })
    expect(sameCaseOrderAction(a,{ ...a,items:[...a.items].reverse() })).toBe(true)
    expect(caseOrderAction({ ...a,notifyCustomer:true })).toBeNull()
    expect(caseOrderAction({ ...a,items:[{ variantId:'222',quantity:1 }] })).toBeNull()
  })
})
