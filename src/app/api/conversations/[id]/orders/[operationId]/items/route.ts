import { NextResponse } from 'next/server'
import { inboxConversation } from '@/lib/inbox/server-context'
import { UUID } from '@/lib/inbox/collaboration'
import { caseOrderSnapshot,caseOrderCurrentItems,CaseOrderError } from '@/lib/inbox/order-actions'
import { shippingChangeAllowed } from '@/lib/shopify/shipping-address-contract'
import { escapeLike } from '@/lib/security/like'
type Context = { params:Promise<{ id:string; operationId:string }> }
export async function GET(request:Request,route:Context) {
  const { id,operationId:orderId }=await route.params, ctx=await inboxConversation(id)
  if (ctx.response) return ctx.response
  if (!UUID.test(orderId)) return NextResponse.json({ error:ctx.t('orderNotFound') },{ status:404 })
  const search=new URL(request.url).searchParams.get('search')?.trim() ?? ''
  if (search.length>100) return NextResponse.json({ error:ctx.t('teamInvalid') },{ status:400 })
  try {
    const snapshot=await caseOrderSnapshot(ctx.db,ctx.workspaceId,ctx.conversation.contact_id,orderId,null,{ shippingOnly:true })
    if (!snapshot.scopes.includes('write_order_edits')) throw new CaseOrderError('orderItemsScopeMissing')
    if (!shippingChangeAllowed(snapshot.live)) throw new CaseOrderError('orderAlreadyShipped')
    const current=caseOrderCurrentItems(snapshot.live)
    let query=ctx.db.from('shopify_products').select('title,raw').eq('workspace_id',ctx.workspaceId).eq('platform','shopify').eq('shop_domain',snapshot.admin.shopDomain).order('title',{ ascending:true }).limit(30)
    if (search) query=query.ilike('title',`%${escapeLike(search)}%`)
    const products=await query
    if (products.error) throw new CaseOrderError('orderItemsUnavailable')
    const variants:{ variantId:string; title:string; variantTitle:string }[]=[]
    for (const product of products.data ?? []) {
      if (product.raw?.status !== 'active' || !Array.isArray(product.raw.variants)) continue
      for (const variant of product.raw.variants.slice(0,100)) {
        const variantId=String(variant.id ?? '')
        if (/^\d{1,20}$/.test(variantId)) variants.push({ variantId,title:product.title,variantTitle:String(variant.title ?? '') })
      }
    }
    return NextResponse.json({ current,variants:variants.slice(0,300) },{ headers:{ 'Cache-Control':'private, no-store' } })
  } catch (error) { return NextResponse.json({ error:ctx.t(error instanceof CaseOrderError ? error.message : 'orderItemsUnavailable') },{ status:409 }) }
}
