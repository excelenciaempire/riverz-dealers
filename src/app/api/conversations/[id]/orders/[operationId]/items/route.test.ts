import { beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ context:vi.fn(),snapshot:vi.fn(),current:vi.fn(),filters:vi.fn(),products:vi.fn() }))
vi.mock('@/lib/inbox/server-context',() => ({ inboxConversation:m.context }))
vi.mock('@/lib/inbox/order-actions',() => ({ caseOrderSnapshot:m.snapshot,caseOrderCurrentItems:m.current,CaseOrderError:class extends Error {} }))
import { GET } from './route'
const order='22222222-2222-4222-8222-222222222222', route={ params:Promise.resolve({ id:'conversation',operationId:order }) }
const current=[{ variantId:'111',quantity:1,free:false,title:'Current',variantTitle:'Small' }]
beforeEach(() => {
  const q={ select:() => q,eq:(...args:unknown[]) => { m.filters(...args); return q },ilike:(...args:unknown[]) => { m.filters(...args); return q },order:() => q,limit:() => q,
    then:(done:(v:unknown) => unknown) => Promise.resolve(m.products()).then(done) }
  m.context.mockReset().mockResolvedValue({ db:{ from:() => q },workspaceId:'workspace',conversation:{ contact_id:'contact' },t:(key:string) => 'localized:'+key })
  m.snapshot.mockReset().mockResolvedValue({ admin:{ shopDomain:'test.myshopify.com' },scopes:['write_order_edits'],live:{ cancelled_at:null,fulfillment_status:null,fulfillments:[] } })
  m.current.mockReset().mockReturnValue(current); m.filters.mockReset()
  m.products.mockReset().mockReturnValue({ data:[{ title:'Catalog product',raw:{ status:'active',variants:[{ id:222,title:'Large' }] } },{ title:'Draft product',raw:{ status:'draft',variants:[{ id:999,title:'Draft' }] } }],error:null })
})
describe('authorized current-store variant selection',() => {
  it('filters the catalog by current workspace, platform and active shop, without exposing raw records',async () => {
    const r=await GET(new Request('https://riverz.co/api/test?search=shoe%25'),route)
    expect(await r.json()).toEqual({ current,variants:[{ variantId:'222',title:'Catalog product',variantTitle:'Large' }] })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    for (const pair of [['workspace_id','workspace'],['platform','shopify'],['shop_domain','test.myshopify.com'],['title','%shoe\\%%']]) expect(m.filters).toHaveBeenCalledWith(...pair)
  })
  it('keeps conversation denials and untrusted order targets before catalog access',async () => {
    m.context.mockResolvedValue({ response:Response.json({ error:'denied' },{ status:403 }) })
    expect((await GET(new Request('https://riverz.co/api/test'),route)).status).toBe(403)
    expect(m.snapshot).not.toHaveBeenCalled(); expect(m.products).not.toHaveBeenCalled()
  })
  it('does not offer edits without their granted scope or after dispatch started',async () => {
    m.snapshot.mockResolvedValue({ admin:{ shopDomain:'test.myshopify.com' },scopes:[],live:{ cancelled_at:null,fulfillment_status:null,fulfillments:[] } })
    expect((await GET(new Request('https://riverz.co/api/test'),route)).status).toBe(409)
    m.snapshot.mockResolvedValue({ admin:{ shopDomain:'test.myshopify.com' },scopes:['write_order_edits'],live:{ cancelled_at:null,fulfillment_status:'partial',fulfillments:[] } })
    expect((await GET(new Request('https://riverz.co/api/test'),route)).status).toBe(409)
    expect(m.products).not.toHaveBeenCalled()
  })
  it('bounds searches and rejects provider identifiers',async () => {
    expect((await GET(new Request(`https://riverz.co/api/test?search=${'a'.repeat(101)}`),route)).status).toBe(400)
    expect((await GET(new Request('https://riverz.co/api/test'),{ params:Promise.resolve({ id:'conversation',operationId:'100' }) })).status).toBe(404)
    expect(m.snapshot).not.toHaveBeenCalled()
  })
})
