import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { engineSendTemplate } from './meta-send';
import { purchaseLines, purchaseLineSummary, purchasedVariantImage } from './purchase-confirmation';

export async function sendPurchasePhotos(db: SupabaseClient, args: {
  workspaceId: string; conversationId: string; contactId: string;
  automationId: string; automationName: string; stepId: string;
  language: string; vars: Record<string, unknown>;
}): Promise<string> {
  const lines = purchaseLines(args.vars.purchase_order_lines);
  const shop = String(args.vars.purchase_shop_domain ?? '');
  const order = String(args.vars.order_id ?? '');
  if (!lines.length || !shop || !order) return 'photos: no order context';
  const templateName = 'deuna_foto_referencia_v1';
  const template = await db.from('message_templates').select('status,header_type,category')
    .eq('workspace_id', args.workspaceId).eq('name', templateName).eq('language', args.language).maybeSingle();
  if (template.error) throw template.error;
  if (template.data?.status !== 'Approved' || template.data?.header_type !== 'image' || template.data?.category !== 'Utility') {
    return 'photos: utility image template not approved';
  }
  const ids = [...new Set(lines.map(l => String(l.product_id ?? '')).filter(id => /^\d+$/.test(id)))];
  if (!ids.length) return 'photos: no product IDs';
  const products = await db.from('shopify_products').select('external_id,raw')
    .eq('workspace_id', args.workspaceId).eq('platform', 'shopify').eq('shop_domain', shop).in('external_id', ids);
  if (products.error) throw products.error;
  let sent = 0, unavailable = 0, failed = 0, existing = 0;
  for (const [index, line] of lines.entries()) {
    const product = products.data?.find(p => String(p.external_id) === String(line.product_id));
    const image = product?.raw && purchasedVariantImage(line, product.raw);
    if (!image) { unavailable++; continue; }
    // One reference per line, not one per unit. Include the order and store so
    // a later purchase of the same variant still receives its own photo.
    const hash = createHash('sha256').update(JSON.stringify([
      'purchase-photo-v1', args.workspaceId, args.contactId, args.automationId, args.stepId,
      shop, order, line.id ?? index,
    ])).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const caption = purchaseLineSummary(line);
    const claim = await db.from('messages').insert({
      id, conversation_id: args.conversationId, sender_type: 'bot', content_type: 'image',
      content_text: caption, media_url: image, template_name: templateName,
      origin: 'automation', origin_name: args.automationName, status: 'sending',
    });
    if (claim.error?.code === '23505') { existing++; continue; }
    if (claim.error) throw claim.error;
    try {
      const result = await engineSendTemplate({
        workspaceId: args.workspaceId, conversationId: args.conversationId, contactId: args.contactId,
        automationName: args.automationName, language: args.language, templateName,
        params: [caption], headerImageUrl: image, reservedMessageId: id, reason: 'transaccional',
      });
      if (!result.whatsapp_message_id) throw new Error('Photo blocked by send gate');
      sent++;
    } catch (error) {
      failed++;
      // A timeout can mean Meta accepted the message. Keep the claim and do
      // not auto-resend. The textual confirmation must still reach the buyer.
      const saved = await db.from('messages').update({ status: 'failed',
        error_reason: error instanceof Error ? error.message : String(error),
      }).eq('id', id).eq('conversation_id', args.conversationId);
      if (saved.error) throw saved.error;
    }
  }
  return `photos: sent=${sent}, unavailable=${unavailable}, failed=${failed}, already_claimed=${existing}`;
}
