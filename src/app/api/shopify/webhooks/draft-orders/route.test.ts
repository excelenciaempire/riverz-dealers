import { beforeEach,describe,it,expect,vi } from 'vitest'
const m=vi.hoisted(() => ({ auth:vi.fn(),recorded:vi.fn(),filters:vi.fn(),upsert:vi.fn(),remove:vi.fn(),contact:vi.fn(),capture:vi.fn(),duplicate:vi.fn() }))
vi.mock('@/lib/automations/admin-client',() => ({ supabaseAdmin:() => ({ from:(table:string) => {
  const q={ select:() => q,eq:(...args:unknown[]) => { m.filters(table,...args); return q },limit:() => q,maybeSingle:m.recorded,
    delete:() => { m.remove(table); return q },upsert:m.upsert,then:(done:(v:unknown) => unknown) => Promise.resolve({ error:null }).then(done) }; return q
} }) }))
vi.mock('@/lib/shopify/webhook-auth',() => ({ verifyShopifyWebhook:m.auth }))
vi.mock('@/lib/shopify/connection',() => ({ getConnectionByShop:async () => ({ row:{ workspace_id:'ws',user_id:'owner' } }) }))
vi.mock('@/lib/workspaces/resolve',() => ({ resolveWorkspaceIdForUser:vi.fn() }))
vi.mock('@/lib/shopify/webhook-dedup',() => ({ isDuplicateDelivery:m.duplicate }))
vi.mock('@/lib/webhooks/capture',() => ({ captureWebhookFailure:m.capture }))
vi.mock('@/lib/shopify/contact-upsert',() => ({ extractShopifyPhone:() => '+15551234567',extractShopifyName:() => 'Ana',extractShopifyLegacyPhone:() => '15551234567',upsertWhatsappContact:m.contact }))
import { POST } from './route'
const request=(tags:unknown) => new Request('https://riverz.co/api/shopify/webhooks/draft-orders',{ method:'POST',headers:{ 'x-shopify-shop-domain':'test.myshopify.com','x-shopify-topic':'draft_orders/create','x-shopify-hmac-sha256':'test' },body:JSON.stringify({ id:44,tags,email:'ana@example.com',invoice_url:'https://example.com/pay',currency:'USD',total_price:'44.00',line_items:[] }) })
beforeEach(() => {
  m.auth.mockReset().mockResolvedValue('valid'); m.recorded.mockReset().mockResolvedValue({ data:null,error:null }); m.filters.mockReset(); m.remove.mockReset()
  m.upsert.mockReset().mockResolvedValue({ error:null }); m.contact.mockReset(); m.capture.mockReset(); m.duplicate.mockReset().mockResolvedValue(false)
})
describe('replacement exclusion from abandoned draft recovery',() => {
  it('does not queue or create a recovery contact for a draft marked in its initial creation',async () => {
    expect(await (await POST(request('riverz_replacement, other'))).json()).toEqual({ ok:true,ignored:'replacement' })
    expect(m.recorded).not.toHaveBeenCalled(); expect(m.contact).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled()
    expect(m.remove).toHaveBeenCalledWith('shopify_checkouts')
    expect(m.filters).toHaveBeenCalledWith('shopify_checkouts','workspace_id','ws')
    expect(m.filters).toHaveBeenCalledWith('shopify_checkouts','shop_domain','test.myshopify.com')
  })
  it('keeps a recorded replacement excluded when a later webhook omits its tags',async () => {
    m.recorded.mockResolvedValue({ data:{ id:'operation' },error:null })
    expect(await (await POST(request(''))).json()).toMatchObject({ ignored:'replacement' })
    expect(m.filters).toHaveBeenCalledWith('inbox_order_actions','result->>draft_id','gid://shopify/DraftOrder/44')
    expect(m.filters).toHaveBeenCalledWith('inbox_order_actions','workspace_id','ws')
    expect(m.contact).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled()
  })
  it('preserves normal draft recovery and contact creation',async () => {
    expect((await POST(request('normal_sale'))).status).toBe(200)
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ checkout_id:'draft_44',workspace_id:'ws',recovery_source:'draft',abandoned_checkout_url:'https://example.com/pay' }),expect.anything())
    expect(m.contact).toHaveBeenCalledTimes(1); expect(m.capture).not.toHaveBeenCalled()
  })
  it('captures an unreadable exclusion receipt without enqueuing a possibly free replacement',async () => {
    const log=vi.spyOn(console,'error').mockImplementation(() => {})
    m.recorded.mockResolvedValue({ data:null,error:{ message:'database unavailable' } })
    await POST(request(''))
    expect(m.capture).toHaveBeenCalledTimes(1); expect(m.upsert).not.toHaveBeenCalled(); expect(m.contact).not.toHaveBeenCalled()
    log.mockRestore()
  })
  it('rejects an invalid signature before reading policy or changing the recovery queue',async () => {
    m.auth.mockResolvedValue('invalid'); expect((await POST(request('riverz_replacement'))).status).toBe(401)
    expect(m.recorded).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled()
  })
})
