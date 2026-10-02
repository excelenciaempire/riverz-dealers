import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const state=vi.hoisted(()=>({enabled:false,admin:true,sections:null as string[]|null,writes:[] as Record<string,unknown>[],steps:[] as unknown[],writable:true}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return state.enabled;}}));
vi.mock('@/lib/mcp/access',()=>({userAccess:vi.fn(async()=>({admin:state.admin,sections:state.sections}))}));
vi.mock('@/lib/billing/read-only',()=>({assertWorkspaceWritable:vi.fn(async()=>{if(!state.writable)throw new Error('subscription_read_only');})}));
vi.mock('./steps-tree',()=>({insertSteps:vi.fn(async(_id,steps)=>{state.steps=steps;return null;})}));
vi.mock('./resolve-tag-seeds',()=>({resolverEtiquetas:vi.fn(async(_db,_ws,steps)=>steps)}));
vi.mock('./install-retention',()=>({installRetentionPackage:vi.fn()}));
import {getTemplate,listTemplates} from './templates';
import {installTemplate} from './install-template';
import {activationIssues} from './activation';
import {translate} from '@/lib/i18n/translate';
const actor='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222';
const db={from:()=>({insert:(row:Record<string,unknown>)=>{state.writes.push(row);return{select:()=>({single:async()=>({data:{id:'33333333-3333-4333-8333-333333333333',...row},error:null})})};}})} as unknown as SupabaseClient;
beforeEach(()=>{state.enabled=false;state.admin=true;state.sections=null;state.writes=[];state.steps=[];state.writable=true;});
describe('Generic delivery issue draft uses the existing editor and installer',()=>{
 it('keeps the normal gallery and direct draft route unchanged while comparison is disabled',async()=>{
  for (const slug of ['toString','constructor','__proto__','unknown']) expect(getTemplate(slug)).toBeNull();
  expect(listTemplates().map(template=>template.slug)).toEqual(['carrito-abandonado','pago-rechazado','pago-pendiente','pago-pendiente-mercadopago','nuevo-pedido','enviar-tracking','postventa-reposicion']);expect(getTemplate('novedad-entrega')).toBeNull();
  await expect(installTemplate(db,{templateId:'novedad-entrega',workspaceId:ws,userId:actor,locale:'es'})).rejects.toThrow();expect(state.writes).toEqual([]);
 });
 it.each(['es','en'] as const)('uses %s copy and existing activation blockers without hardcoded store or agent IDs',locale=>{
  state.enabled=true;const template=getTemplate('novedad-entrega',locale)!;expect(template.trigger_type).toBe('shopify_order_incident_opened');expect(template.trigger_config).toMatchObject({stop_on_inbound:true,delivery_incident_context:true});
  expect(JSON.stringify(template)).not.toMatch(/DeUNA|36f81b96|handoff_ai_agent_id/);expect(template.suggested_template_body).toContain(locale==='es'?'novedad de entrega':'delivery issue');
  expect(template.steps[0].step_config).toMatchObject({template_name:'',language:locale});const issues=activationIssues({triggerType:template.trigger_type,triggerConfig:template.trigger_config,steps:template.steps as never});expect(issues.some(issue=>issue.path.includes('template_name'))).toBe(true);expect(issues.some(issue=>issue.path.includes('tag_id'))).toBe(true);
  expect(translate(locale,'automations.tpl_novedad-entrega_name')).toBe(locale==='es'?'Novedad de entrega':'Delivery issue');expect(listTemplates(locale).at(-1)?.slug).toBe('novedad-entrega');
 });
 it('creates only a paused draft belonging to the selected business and actual actor',async()=>{
  state.enabled=true;const result=await installTemplate(db,{templateId:'novedad-entrega',workspaceId:ws,userId:actor,actorId:actor,locale:'en'});expect(result.is_active).toBe(false);expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({workspace_id:ws,user_id:actor,name:'Delivery issue',is_active:false});expect(state.steps).toHaveLength(3);
 });
 it.each(['role','section','subscription','actor'])('denies current invalid %s before writing a draft',async kind=>{
  state.enabled=true;if(kind==='role')state.admin=false;if(kind==='section')state.sections=['/pedidos'];if(kind==='subscription')state.writable=false;
  await expect(installTemplate(db,{templateId:'novedad-entrega',workspaceId:ws,userId:kind==='actor'?null:actor,locale:'es'})).rejects.toThrow();expect(state.writes).toEqual([]);expect(state.steps).toEqual([]);
 });
});
