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
  const note = `Página vigente proporcionada por el comercio: ${productUrl}. Consulta Shopify para precio, modelo y disponibilidad; no uses la antigua bola-saltarina ni ofertas de combos anteriores. La página describe juego activo y luces LED, pero no acredita límites de edad/peso, baterías ni certificaciones.`;
  const patch = {
    url: productUrl,
    custom_notes: (product.custom_notes ?? '').includes(note) ? product.custom_notes : `${product.custom_notes ?? ''}\n${note}`,
    // Structured objections are injected separately by the runner. They must agree
    // with the FAQs; clearing only training_material leaves old claims active.
    structured_research: {
      differentiators: ['Juego activo con saltos y luces LED.', 'Variedad de modelos según catálogo vigente.'],
      objections: [
        { objection: '¿Hay descuentos por varias unidades?', rebuttal: 'Solo ofrecemos promociones que el catálogo y la herramienta validen actualmente.' },
        { objection: '¿Incluye baterías o se pueden cambiar?', rebuttal: 'El mecanismo de alimentación y los accesorios requieren confirmación del proveedor.' },
        { objection: '¿Puedo abrirlo antes de pagar?', rebuttal: 'Contraentrega significa pagar al recibir. No garantiza apertura previa; debe verificarse con la transportadora.' },
      ],
    },
    scraped_content: null,
    training_material_built_at: new Date().toISOString(),
  };
  const { error: updateError } = await db.from('shopify_products').update({
    ...patch, training_material: buildTrainingMaterial({ ...product, ...patch }, 'es'),
  }).eq('id', product.id).eq('workspace_id', workspaceId);
  if (updateError) throw updateError;
  console.log(JSON.stringify({ sync, productUrl, structuredClaimsCorrected: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
