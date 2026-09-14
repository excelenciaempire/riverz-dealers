/** Preview by default. --apply submits reviewed templates; --bind switches this
 * merchant's steps after the product-context code has been deployed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { TemplateButtonInput } from '../src/lib/whatsapp/template-components';
import { productTemplates, productTemplateName, RIVERZOFICIAL_WORKSPACE } from './riverzoficial-copy';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const samples: Record<string,string> = { contact_first_name: 'Ana', order_items: '1 × Pelota saltarina LED (Rana Verde)', total_price_display: '110.000 COP', delivery_address: 'Calle 10 # 20-30, Cali', delivery_phone: '+573000000000', tracking_number: '024034940186' };
async function main() {
  const { crearPlantilla, resolverWabaYToken } = await import('@/lib/templates/create');
  const { withAppsecretProof } = await import('@/lib/channels/meta-graph');
  const { data: rows, error } = await db.from('message_templates').select('*').eq('workspace_id', RIVERZOFICIAL_WORKSPACE);
  if (error) throw error;
  const apply = process.argv.includes('--apply');
  const bind = process.argv.includes('--bind');
  const { data: flows, error: flowError } = await db.from('automations').select('id,name').eq('workspace_id', RIVERZOFICIAL_WORKSPACE).is('deleted_at', null);
  if (flowError) throw flowError;
  mkdirSync('tmp', { recursive: true });
  const run = Date.now();
  writeFileSync(`tmp/riverzoficial-product-copy-backup-${run}.json`, JSON.stringify(rows, null, 2));
  for (const item of productTemplates) {
    for (const language of ['es','en'] as const) {
      const name = productTemplateName(item.key);
      const body = item[language];
      const placeholders = [...new Set(body.match(/\{\{\d+\}\}/g) ?? [])];
      if (body.length > 1024 || /\uFFFD/.test(body) || placeholders.join() !== item.fields.map((_,i)=>`{{${i+1}}}`).join() || !item.fields.includes('order_items')) throw new Error(`Invalid reviewed template: ${name}`);
      const fields = Object.fromEntries(item.fields.map((field,i)=>[String(i+1),field]));
      const old = item.aliases.map(alias=>rows?.find(row=>row.name===alias && row.language==='es')).find(Boolean);
      if (!old) throw new Error(`Missing source for ${name}`);
      let current = rows?.find(row=>row.name===name && row.language===language);
      if (current && (current.body_text !== body || JSON.stringify(current.variable_fields) !== JSON.stringify(fields))) {
        // JSONB key ordering can differ, compare the actual entries.
        if (current.body_text !== body || Object.entries(fields).some(([k,v])=>current.variable_fields?.[k]!==v) || Object.keys(current.variable_fields??{}).length!==item.fields.length) throw new Error(`Existing template differs: ${name}`);
      }
      if (!apply && !bind) { console.log(JSON.stringify({name,language,body,fields})); continue; }
      if (!current && !apply) throw new Error(`Submit before binding: ${name}/${language}`);
      if (!current) {
        let buttons = (old.buttons ?? []) as TemplateButtonInput[];
        if (language === 'en') buttons = buttons.map(b=>({...b,text: ({CONFIRMAR:'CONFIRM',CORREGIR:'CORRECT','Retomar compra':'Continue shopping','Ver mi carrito':'View my cart'} as Record<string,string>)[b.text]??b.text}));
        const created = await crearPlantilla(db,{ workspaceId: RIVERZOFICIAL_WORKSPACE,userId:old.user_id,nombre:name,idioma:language,categoria:old.category.toUpperCase(),headerType:'none',bodyText:body,buttons,bodySamples:item.fields.map(f=>language==='en'&&f==='order_items'?'1 × LED bouncing ball (Green Frog)':samples[f]),variableFields:fields,enviarAMeta:true });
        if (!created.ok) throw new Error(`${name}/${language}: ${created.mensaje??created.claveI18n}`);
        const {data,error:e}=await db.from('message_templates').select('*').eq('id',created.id!).eq('workspace_id',RIVERZOFICIAL_WORKSPACE).single();
        if(e)throw e;current=data;
      }
      const {accessToken}=await resolverWabaYToken(db,RIVERZOFICIAL_WORKSPACE,old.user_id);
      const response=await fetch(withAppsecretProof(`https://graph.facebook.com/v21.0/${current.meta_template_id}`,accessToken),{headers:{Authorization:`Bearer ${accessToken}`}});
      const remote=await response.json();
      if(!response.ok||remote.name!==name||remote.language!==language||remote.components?.find((c:{type:string})=>c.type==='BODY')?.text!==body)throw new Error(`Meta verification failed: ${name}/${language}`);
      const statuses:Record<string,string>={APPROVED:'Approved',PENDING:'Pending',REJECTED:'Rejected',PAUSED:'Paused',DISABLED:'Disabled'};
      if(!statuses[remote.status])throw new Error(`Unknown Meta status: ${remote.status}`);
      const {error:saveError}=await db.from('message_templates').update({status:statuses[remote.status],meta_status:remote.status}).eq('id',current.id).eq('workspace_id',RIVERZOFICIAL_WORKSPACE);if(saveError)throw saveError;
      console.log(JSON.stringify({name,language,status:remote.status}));
    }
  }
  if(bind){
    for(const flow of flows??[]){
      const {data:steps,error:e}=await db.from('automation_steps').select('id,step_config,step_type').eq('automation_id',flow.id);if(e)throw e;
      writeFileSync(`tmp/riverzoficial-product-steps-${run}-${flow.id}.json`,JSON.stringify(steps,null,2));
      for(const step of steps??[]){
        if(step.step_type!=='send_template')continue;
        const previous=String(step.step_config?.template_name??'').replace(/_human_v1$/,'');
        const item=productTemplates.find(p=>p.aliases.includes(previous)||productTemplateName(p.key)===previous);
        if(!item)throw new Error(`Unreviewed template in ${flow.name}: ${previous}`);
        const config={...step.step_config,template_name:productTemplateName(item.key),variables:Object.fromEntries(item.fields.map((f,i)=>[String(i+1),`{{vars.${f}}}`]))};
        const {error:changeError}=await db.from('automation_steps').update({step_config:config}).eq('id',step.id).eq('automation_id',flow.id);if(changeError)throw changeError;
        const {data:verified,error:verifyError}=await db.from('automation_steps').select('step_config').eq('id',step.id).single();if(verifyError)throw verifyError;
        if(verified.step_config.template_name!==config.template_name||Object.entries(config.variables).some(([k,v])=>verified.step_config.variables[k]!==v))throw new Error('Binding readback failed');
      }
    }
    const {reconcileWorkspaceAutomationReadiness}=await import('@/lib/automations/activation');
    console.log(JSON.stringify({readiness:await reconcileWorkspaceAutomationReadiness(db,RIVERZOFICIAL_WORKSPACE)}));
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:JSON.stringify(e));process.exitCode=1;});
