/** Publish copy and photo templates, then opt in the initial confirmation step.
 * Does not send customer messages or replay existing orders.
 * node --env-file=.env.local --import tsx scripts/publish-deuna-purchase-confirmation.ts --submit
 * ... --apply --deployed-commit=<40-character SHA>
 */
import { createClient } from '@supabase/supabase-js';
import { purchaseConfirmationTemplates } from '../src/lib/automations/purchase-confirmation';
import { crearPlantilla, resolverWabaYToken } from '../src/lib/templates/create';
import { uploadTemplateHeaderMedia } from '../src/lib/whatsapp/template-media';
import { withAppsecretProof } from '../src/lib/channels/meta-graph';

const workspace = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const automation = 'f29f3d74-f10f-42a5-946a-15b254a70106';
const stepId = 'f43f52d3-4e1e-46af-98f8-fe25a93c2901';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const definitions = [...purchaseConfirmationTemplates('es'), ...purchaseConfirmationTemplates('en')];
  if (!process.argv.includes('--submit') && !process.argv.includes('--apply')) {
    console.log(JSON.stringify(definitions, null, 2)); return;
  }
  const flow = await db.from('automations').select('user_id').eq('id', automation).eq('workspace_id', workspace).is('deleted_at', null).single();
  if (flow.error) throw flow.error;
  const { wabaId, accessToken } = await resolverWabaYToken(db, workspace, flow.data.user_id);
  if (!wabaId || !accessToken) throw new Error('WhatsApp account unavailable');
  let headerHandle: string | undefined;
  let ready = true;
  for (const item of definitions) {
    const local = await db.from('message_templates').select('id,body_text,header_type,status')
      .eq('workspace_id', workspace).eq('name', item.name).eq('language', item.language).maybeSingle();
    if (local.error) throw local.error;
    if (local.data && (local.data.body_text !== item.body || (local.data.header_type ?? 'none') !== item.headerType)) {
      throw new Error(`Template mismatch: ${item.name}/${item.language}`);
    }
    if (!local.data || local.data.status === 'Draft') {
      if (!process.argv.includes('--submit')) throw new Error('Submit templates before applying');
      if (item.headerType === 'image' && !headerHandle) {
        const product = await db.from('shopify_products').select('image_url').eq('workspace_id', workspace)
          .eq('external_id', '15296016875884').eq('platform', 'shopify').single();
        if (product.error) throw product.error;
        const sample = await fetch(product.data.image_url, { signal: AbortSignal.timeout(20_000) });
        if (!sample.ok) throw new Error(`Sample image: ${sample.status}`);
        const appResponse = await fetch('https://graph.facebook.com/v21.0/app?fields=id', {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000),
        });
        if (!appResponse.ok) throw new Error(`WhatsApp app lookup: ${appResponse.status}`);
        const app = await appResponse.json() as { id?: string };
        if (!app.id) throw new Error('WhatsApp app ID unavailable');
        headerHandle = await uploadTemplateHeaderMedia({ appId: app.id, accessToken,
          file: new File([await sample.arrayBuffer()], 'purchase-reference.jpg', { type: 'image/jpeg' }) });
      }
      const result = await crearPlantilla(db, {
        workspaceId: workspace, userId: flow.data.user_id, nombre: item.name, idioma: item.language,
        categoria: 'UTILITY', headerType: item.headerType,
        headerHandle: item.headerType === 'image' ? headerHandle : undefined,
        bodyText: item.body, buttons: item.buttons, bodySamples: item.samples,
        variableFields: Object.fromEntries(item.fields.map((field, i) => [String(i + 1), field])),
        plantillaExistenteId: local.data?.id, enviarAMeta: true,
      });
      if (!result.ok) throw new Error(result.mensaje ?? result.claveI18n);
    }
    const url = withAppsecretProof(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${item.name}&fields=name,language,status,category,components&limit=100`, accessToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Template status: ${response.status}`);
    const body = await response.json() as { data: Array<{ name: string; language: string; status: string; category: string; components: Array<{ type: string; text?: string; format?: string }> }> };
    const remote = body.data.find(t => t.name === item.name && t.language === item.language);
    if (!remote) throw new Error(`Remote template missing: ${item.name}/${item.language}`);
    if (remote.components.find(c => c.type === 'BODY')?.text !== item.body) throw new Error('Remote copy mismatch');
    const status = remote.status === 'APPROVED' ? 'Approved' : remote.status === 'REJECTED' ? 'Rejected' : 'Pending';
    const saved = await db.from('message_templates').update({ status, category: remote.category === 'UTILITY' ? 'Utility' : 'Marketing' })
      .eq('workspace_id', workspace).eq('name', item.name).eq('language', item.language);
    if (saved.error) throw saved.error;
    console.log(JSON.stringify({ name: item.name, language: item.language, status, category: remote.category }));
    if (status !== 'Approved' || remote.category !== 'UTILITY') ready = false;
  }
  if (!process.argv.includes('--apply')) return;
  if (!ready) throw new Error('Meta approval pending; current confirmation remains active');
  const commit = process.argv.find(a => a.startsWith('--deployed-commit='))?.split('=')[1];
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Exact deployed commit required');
  const version = await fetch('https://riverz.co/api/version', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!version.ok || (await version.json()).commit !== commit) throw new Error('Required build is not serving yet');
  const step = await db.from('automation_steps').select('step_config').eq('automation_id', automation).eq('id', stepId).eq('step_type', 'send_template').single();
  if (step.error) throw step.error;
  if (!['deuna_confirmacion_producto_v1', 'deuna_resumen_compra_general_v1'].includes(step.data.step_config.template_name)) throw new Error('Initial step changed; inspect before applying');
  const definition = purchaseConfirmationTemplates('es').find(t => t.name === 'deuna_resumen_compra_general_v1')!;
  const cfg = { ...step.data.step_config, template_name: definition.name, purchase_confirmation: true,
    variables: Object.fromEntries(definition.fields.map((f, i) => [String(i + 1), `{{vars.${f}}}`])) };
  const changed = await db.from('automation_steps').update({ step_config: cfg }).eq('automation_id', automation).eq('id', stepId)
    .filter('step_config', 'eq', JSON.stringify(step.data.step_config)).select('id');
  if (changed.error || changed.data?.length !== 1) throw new Error('Concurrent step update');
  const verified = await db.from('automation_steps').select('step_config').eq('automation_id', automation).eq('id', stepId).single();
  if (verified.error || !verified.data?.step_config.purchase_confirmation || verified.data.step_config.template_name !== definition.name) throw new Error('Activation verification failed');
  console.log('Verified: initial confirmation updated; reminders and pending orders preserved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
