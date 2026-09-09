/** Refresh the merchant-supplied product URL without importing unsupported sales claims. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const productUrl = 'https://deunashop.shop/products/pelota-saltarina';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { tokenVivo } = await import('@/lib/shopify/token-vivo');
  const { syncShopifyProducts } = await import('@/lib/shopify/product-sync');
  const { buildTrainingMaterial } = await import('@/lib/products/training-material');
  const { data: connection, error } = await db.from('shopify_connections').select('*')
    .eq('workspace_id', workspaceId).eq('shop_domain', 'bs9mqe-na.myshopify.com').eq('status', 'active').single();
  if (error) throw error;
  const { accessToken } = await tokenVivo(db, connection);
  const response = await fetch(productUrl);
  if (!response.ok || response.url !== productUrl) throw new Error('Product page unavailable or redirected');
  const sync = await syncShopifyProducts(db, {
    workspaceId, userId: connection.user_id, shopDomain: connection.shop_domain, accessToken,
  });
  const { data: product, error: productError } = await db.from('shopify_products').select('*')
    .eq('workspace_id', workspaceId).eq('external_id', '15277436567916').single();
  if (productError) throw productError;
  const configResponse = await fetch('https://riverzai.com/api/landing-lab/cod-config?project_id=pniv0908a1', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Live COD offers unavailable; do not overwrite existing offers');
  const cod = await configResponse.json() as {
    ok: boolean;
    product: { currencyCode: string; variants: Array<{ id: string }> };
    settings: { enabled: boolean; checkoutMode: string; shipping: { mode: string; price: number }; offers: Array<{ id: string; title: string; quantity: number; price: number; enabled: boolean }> };
  };
  const knownVariants = new Set((product.raw.variants as Array<{ id: number }>).map(v => String(v.id)));
  if (!cod.ok || !cod.settings.enabled || cod.settings.checkoutMode !== 'cod' || cod.product.currencyCode !== product.currency || !cod.product.variants.length || cod.product.variants.some(v => !knownVariants.has(v.id))) {
    throw new Error('COD configuration does not match the connected Shopify product');
  }
  const offers = cod.settings.offers.filter(o => o.enabled !== false).map(o => {
    if (!Number.isInteger(o.quantity) || o.quantity < 1 || !Number.isFinite(o.price) || o.price <= 0) throw new Error('Invalid COD offer');
    return { label: o.title, units: o.quantity, total: o.price, conditions: `Vigente en el formulario contraentrega de ${productUrl}. Para combos o modelos mezclados, finalizar allí; no crear un pedido Admin API a precio unitario ni prometer aplicar un descuento que esa herramienta no soporta.` };
  });
  const note = `Página vigente proporcionada por el comercio: ${productUrl}. Consulta Shopify para precio, modelo y disponibilidad; no uses la antigua bola-saltarina ni ofertas de combos anteriores. La página describe juego activo y luces LED, pero no acredita límites de edad/peso, baterías ni certificaciones.`;
  const currentNotes = String(product.custom_notes ?? '').replace('La página contiene referencias a NIVELSHOP de una plantilla importada: nunca usar ese nombre como identidad de DeUNA Shop.', 'La identidad comercial es DeUNA Shop.');
  const patch = {
    url: productUrl,
    allowed_offers: offers,
    say_guidelines: `Habla como DeUNA Shop. Precio individual según Shopify; ofertas de este producto según allowed_offers, verificadas en su formulario contraentrega. Para combos o mezcla de modelos, envía ${productUrl} y guía al cliente a completar el formulario, que calcula el total correcto. No crees otro pedido si ya completó ese formulario.`,
    custom_notes: currentNotes.includes(note) ? currentNotes : `${currentNotes}\n${note}`,
    // Structured objections are injected separately by the runner. They must agree
    // with the FAQs; clearing only training_material leaves old claims active.
    structured_research: {
      differentiators: ['Juego activo con saltos y luces LED.', 'Variedad de modelos según catálogo vigente.'],
      objections: [
        { objection: '¿Hay descuentos por varias unidades?', rebuttal: `Ofertas vigentes verificadas en el formulario: ${offers.map(o => `${o.units} por ${o.total} COP`).join('; ')}. Se finalizan en la página del producto, sin duplicar la compra por chat.` },
        { objection: '¿Incluye baterías o se pueden cambiar?', rebuttal: 'El mecanismo de alimentación y los accesorios requieren confirmación del proveedor.' },
        { objection: '¿Puedo abrirlo antes de pagar?', rebuttal: 'Contraentrega significa pagar al recibir. No garantiza apertura previa; debe verificarse con la transportadora.' },
      ],
    },
    scraped_content: null,
    custom_faqs: (product.custom_faqs as Array<{ q: string; a: string }>).filter(f => f.q !== '¿Qué ofertas tiene el formulario?' && f.q !== '¿Cuánto cuesta el envío en el formulario?').concat([
      { q: '¿Qué ofertas tiene el formulario?', a: `${offers.map(o => `${o.units} unidad(es): ${o.total} COP`).join('; ')}. Elegir modelos disponibles y finalizar en ${productUrl}. No aplicar estas ofertas a otros productos.` },
      { q: '¿Cuánto cuesta el envío en el formulario?', a: cod.settings.shipping.mode === 'free' && cod.settings.shipping.price === 0 ? 'El formulario vigente muestra envío gratis. La ciudad y dirección se validan al completar el pedido; esto no garantiza cobertura ni una fecha de entrega.' : 'Consultar el costo mostrado en el formulario vigente antes de confirmar.' },
    ]),
    training_material_built_at: new Date().toISOString(),
  };
  const { error: updateError } = await db.from('shopify_products').update({
    ...patch, training_material: buildTrainingMaterial({ ...product, ...patch }, 'es'),
  }).eq('id', product.id).eq('workspace_id', workspaceId);
  if (updateError) throw updateError;
  console.log(JSON.stringify({ sync, productUrl, structuredClaimsCorrected: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
