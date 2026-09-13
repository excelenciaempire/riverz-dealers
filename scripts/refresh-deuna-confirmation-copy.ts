/** Register revised copy; switch existing steps only after approval and deployment.
 * No message sends, call scheduling, wait resets or logistics activation.
 * node --env-file=.env.local --import tsx scripts/refresh-deuna-confirmation-copy.ts --submit
 * ... --apply --deployed-commit=<commit containing confirmationDisplayVars>
 */
import { createClient } from '@supabase/supabase-js';
import { confirmationCopy } from '../src/lib/automations/confirmation-copy';
import { crearPlantilla, resolverWabaYToken } from '../src/lib/templates/create';
import { withAppsecretProof } from '../src/lib/channels/meta-graph';
const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const automationId = 'f29f3d74-f10f-42a5-946a-15b254a70106';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const flow = await db.from('automations').select('id,user_id,is_active,trigger_config')
    .eq('workspace_id', workspaceId).eq('id', automationId).is('deleted_at', null).single();
  if (flow.error) throw flow.error;
  const definitions = [...confirmationCopy('es'), ...confirmationCopy('en')];
  if (!process.argv.includes('--submit') && !process.argv.includes('--apply')) {
    console.log(JSON.stringify(definitions, null, 2)); return;
  }
  for (const item of definitions) {
    const existing = await db.from('message_templates').select('id,status,body_text')
      .eq('workspace_id', workspaceId).eq('name', item.name).eq('language', item.language).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.body_text !== item.body) throw new Error(`Template content mismatch: ${item.name}/${item.language}`);
    if (!existing.data || existing.data.status === 'Draft') {
      if (!process.argv.includes('--submit')) throw new Error('Submit templates before applying');
      const result = await crearPlantilla(db, { workspaceId, userId: flow.data.user_id,
        nombre: item.name, idioma: item.language, categoria: 'UTILITY', bodyText: item.body,
        buttons: item.buttons, bodySamples: item.samples, enviarAMeta: true,
        plantillaExistenteId: existing.data?.id,
        variableFields: Object.fromEntries(item.fields.map((f,i)=>[String(i+1),f])),
      });
      if (!result.ok) throw new Error(result.mensaje ?? result.claveI18n);
      console.log(JSON.stringify({ name: item.name, language: item.language, status: result.estado }));
    }
  }
  const { wabaId, accessToken } = await resolverWabaYToken(db, workspaceId, flow.data.user_id);
  if (!wabaId || !accessToken) throw new Error('WhatsApp template account unavailable');
  let allApproved = true;
  for (const item of definitions) {
    const url = withAppsecretProof(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${encodeURIComponent(item.name)}&fields=id,name,status,language&limit=100`, accessToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Template status read: ${response.status}`);
    const body = await response.json() as { data: Array<{ name: string; language: string; status: string }> };
    const remote = body.data.find(t=>t.name===item.name && t.language===item.language);
    const status = remote?.status === 'APPROVED' ? 'Approved' : remote?.status === 'REJECTED' ? 'Rejected' : 'Pending';
    const saved = await db.from('message_templates').update({ status }).eq('workspace_id', workspaceId).eq('name', item.name).eq('language', item.language);
    if (saved.error) throw saved.error;
    console.log(JSON.stringify({ name: item.name, language: item.language, status }));
    if (item.language === 'es' && status !== 'Approved') allApproved = false;
  }
  if (!process.argv.includes('--apply')) return;
  if (!allApproved) { console.log('Copy staged; Spanish approval still pending. Existing flow unchanged.'); return; }
  const required = process.argv.find(a=>a.startsWith('--deployed-commit='))?.split('=')[1];
  if (!required || !/^[a-f0-9]{40}$/.test(required)) throw new Error('Exact deployed commit required before changing variable mappings');
  const version = await fetch('https://riverz.co/api/version', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!version.ok || (await version.json()).commit !== required) throw new Error('Required build is not serving yet');
  const steps = await db.from('automation_steps').select('id,step_type,step_config').eq('automation_id', automationId);
  if (steps.error) throw steps.error;
  for (const item of confirmationCopy('es')) {
    const matches = steps.data.filter(s=>s.step_type==='send_template' && [item.previous,item.name].includes(s.step_config.template_name));
    if (matches.length !== 1) throw new Error(`Expected one step for ${item.name}`);
    const step=matches[0];
    const updated=await db.from('automation_steps').update({step_config:{...step.step_config, template_name:item.name,
      variables:Object.fromEntries(item.fields.map((f,i)=>[String(i+1),`{{vars.${f}}}`]))}})
      .eq('automation_id',automationId).eq('id',step.id).filter('step_config','eq',JSON.stringify(step.step_config)).select('id');
    if (updated.error || updated.data?.length!==1) throw new Error('Step changed concurrently; inspect before retry');
  }
  console.log('Three copy updates applied. Existing waits, calls and activation state preserved.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
