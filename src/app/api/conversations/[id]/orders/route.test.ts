import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),snapshot:vi.fn(),prepare:vi.fn(),replacement:vi.fn(),hold:vi.fn(),credit:vi.fn(),prior:vi.fn(),rpc:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/csrf',() => ({ csrfGuard:async () => null }))
vi.mock('@/lib/inbox/order-actions',() => ({ caseOrderSnapshot:m.snapshot,CaseOrderError:class extends Error {} }))
vi.mock('@/lib/shopify/reviewed-order-items',() => ({ prepareReviewedOrderItems:m.prepare }))
vi.mock('@/lib/shopify/replacement-draft',() => ({ prepareReplacementDraft:m.replacement }))
vi.mock('@/lib/shopify/fulfillment-hold',() => ({ prepareFulfillmentHold:m.hold }))
vi.mock('@/lib/shopify/store-credit',() => ({ prepareStoreCredit:m.credit }))
import { POST } from './route'
const input={ id:'11111111-1111-4111-8111-111111111111',order_id:'22222222-2222-4222-8222-222222222222',action:{ type:'items',reason:'Size change',items:[{ variantId:'222',quantity:2,free:false }] } }
const route={ params:Promise.resolve({ id:'conversation' }) }
const post=(body:unknown) => POST(new Request('https://riverz.co/api/test',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(body) }),route)
const quote={ calculated_id:'gid://shopify/CalculatedOrder/1',total_after:'120.00' }
beforeEach(() => {
  const q={ select:() => q,eq:() => q,maybeSingle:m.prior }
  m.context.mockReset().mockResolvedValue({ db:{ from:() => q,rpc:m.rpc },workspaceId:'workspace',userId:'user',isAdmin:false,conversation:{ id:'conversation',contact_id:'contact' },t:(key:string) => 'localized:'+key })
  m.prior.mockReset().mockResolvedValue({ data:null,error:null })
  m.rpc.mockReset().mockImplementation(async (name:string,args:Record<string,unknown>) => ({ data:name==='workspace_billing_write_allowed' ? true : { action:args.p_action,preview:args.p_preview },error:null }))
  m.snapshot.mockReset().mockResolvedValue({ admin:{ shopDomain:'test.myshopify.com' },local:{ shopify_order_id:'100' },preview:{},fingerprint:'a'.repeat(64) })
  m.prepare.mockReset().mockResolvedValue({ ok:true,quote })
  m.replacement.mockReset().mockResolvedValue({ ok:true,quote:{ total:'44.00',currency:'USD' } })
  m.hold.mockReset().mockResolvedValue({ ok:true,quote:{ fingerprint:'hold',preparations:[] } })
  m.credit.mockReset().mockResolvedValue({ ok:true,quote:{ fingerprint:'credit',amount:'5.25',currency:'USD' } })
})
describe('persistent reviewed item previews',() => {
  it('checks subscription permission before any staged Shopify mutation',async () => {
    m.rpc.mockResolvedValue({ data:false,error:null })
    const r=await post(input)
    expect(r.status).toBe(409); expect(await r.json()).toEqual({ error:'localized:orderReadOnly' })
    expect(m.prepare).not.toHaveBeenCalled()
  })
  it('saves the actual quote and lets an agent prepare without authorizing execution',async () => {
    const r=await post(input)
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ can_execute:false,operation:{ preview:{ item_change:quote } } })
    expect(m.rpc).toHaveBeenCalledWith('save_inbox_order_preview',expect.objectContaining({ p_actor_id:'user',p_action:input.action,p_preview:{ item_change:quote } }))
  })
  it('recovers an existing JSONB nested preview without another Shopify edit',async () => {
    const address={ address1:'20 Main St',address2:'',city:'Austin',province:'Texas',zip:'78701',countryCode:'US' }
    const action={ type:'address',reason:'Customer request',address }
    m.prior.mockResolvedValue({ data:{ requested_by:'user',order_id:input.order_id,action:{ address:Object.fromEntries(Object.entries(address).reverse()),reason:action.reason,type:action.type } },error:null })
    expect((await post({ ...input,action })).status).toBe(200)
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects a reused identifier with changed items or another actor',async () => {
    for (const patch of [{ requested_by:'foreign' },{ action:{ ...input.action,items:[{ variantId:'999',quantity:2,free:false }] } }]) {
      m.prior.mockResolvedValue({ data:{ requested_by:'user',order_id:input.order_id,action:input.action,...patch },error:null })
      expect((await post(input)).status).toBe(409)
    }
    expect(m.prepare).not.toHaveBeenCalled()
  })
  it('keeps conversation denials and malformed provider targets before provider access',async () => {
    expect((await post({ ...input,shop_domain:'foreign.myshopify.com' })).status).toBe(400)
    m.context.mockResolvedValue({ response:Response.json({ error:'denied' },{ status:403 }) })
    expect((await post(input)).status).toBe(403)
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled()
  })
  it('stores a calculated replacement without staging an edit to the source order',async () => {
    const replacement={ ...input,action:{ ...input.action,type:'replacement' } }
    const live={ id:100,customer:{ id:22 } }
    m.snapshot.mockResolvedValue({ admin:{ shopDomain:'test.myshopify.com' },live,preview:{},fingerprint:'a'.repeat(64) })
    expect(await (await post(replacement)).json()).toMatchObject({ can_execute:false,operation:{ preview:{ replacement:{ total:'44.00',currency:'USD' } } } })
    expect(m.replacement).toHaveBeenCalledWith(expect.anything(),live,replacement.action.items,input.id,replacement.action.reason)
    expect(m.prepare).not.toHaveBeenCalled()
    m.rpc.mockResolvedValue({ data:false,error:null }); m.replacement.mockClear()
    expect((await post(replacement)).status).toBe(409); expect(m.replacement).not.toHaveBeenCalled()
  })
  it('saves a read-only hold review without preparing an order edit or replacement',async () => {
    const r=await post({ ...input,action:{ type:'hold',reason:'Pause' } })
    expect(await r.json()).toMatchObject({ can_execute:false,operation:{ preview:{ hold:{ fingerprint:'hold' } } } })
    expect(m.hold).toHaveBeenCalledWith(expect.anything(),'100')
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.replacement).not.toHaveBeenCalled()
  })
  it('stores a credit review without issuing funds or preparing any other Shopify mutation',async () => {
    const r=await post({ ...input,action:{ type:'credit',amount:5.25,reason:'Goodwill' } })
    expect(await r.json()).toMatchObject({ can_execute:false,operation:{ preview:{ credit:{ amount:'5.25',currency:'USD' } } } })
    expect(m.credit).toHaveBeenCalledWith(expect.anything(),undefined,5.25)
    expect(m.prepare).not.toHaveBeenCalled(); expect(m.replacement).not.toHaveBeenCalled(); expect(m.hold).not.toHaveBeenCalled()
  })
})
