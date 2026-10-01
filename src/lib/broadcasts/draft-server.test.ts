import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { editableDraft } from './draft'
import { draftTemplate, prepareDraftRecipients } from './draft-server'
const state = vi.hoisted(() => ({ proof: { id: 'template', body_text: 'Hi {{1}} {{2}}', category: 'Utility', status: 'Approved' }, segment: [] as Record<string, unknown>[] }))
vi.mock('./delivery', () => ({ loadBroadcastTemplate: vi.fn(async () => state.proof) }))
vi.mock('@/lib/segments/resolve', () => ({ resolveSegment: vi.fn(async () => ({ contacts: state.segment })) }))
const ws='workspace', a='11111111-1111-4111-8111-111111111111', tag='22222222-2222-4222-8222-222222222222'
let contacts: Record<string, unknown>[], excluded: string[], queries: unknown[][], error: unknown, count: number, customRows: Record<string, unknown>[], template: Record<string, unknown>
const db = { from(table: string) {
  let start=0,end=999,ids: string[]|null=null
  const result=()=>({ error, count, data: table==='contacts' ? contacts.slice(start,end+1) : table==='tags' ? [{id:tag}] : table==='custom_fields' ? [{id:a}] : table==='contact_tags' ? excluded.map(contact_id=>({contact_id})) : table==='contact_custom_values' ? customRows : table==='message_templates' ? template : table==='contact_segments' ? {rules:[],match_mode:'all',workspace_id:ws} : [] })
  const q={ select: (...args:unknown[])=>{queries.push([table,'select',...args]);return q},eq:(...args:unknown[])=>{queries.push([table,'eq',...args]);return q},in:(field:string,v:string[])=>{queries.push([table,'in',field,v]);if(field==='contact_id')ids=v;return q},order:()=>q,range:(from:number,to:number)=>{start=from;end=to;return q},overrideTypes:()=>q,maybeSingle:async()=>result(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({...result(),data:table==='contact_custom_values'&&ids?customRows.filter(r=>ids!.includes(String(r.contact_id))):result().data}).then(resolve) };return q
} } as unknown as SupabaseClient
const config=()=>editableDraft({name:'Test',template_name:'hello',template_language:'es',audience_filter:{type:'all'},template_variables:{'1':{type:'field',value:'first_name'},'2':{type:'static',value:'Shipping excluded'}}})
beforeEach(()=>{contacts=[{id:'contact',workspace_id:ws,name:'Ana Perez',phone:'573003364305',opted_out:false}];excluded=[];queries=[];error=null;count=1;customRows=[];template={...state.proof,name:'hello',language:'es',header_type:null,header_content:null,buttons:null};state.segment=[]})
describe('business-scoped reviewed campaign recipients',()=>{
 it('uses all contacts in the current workspace, opt-out filtering and complete fixed/dynamic params',async()=>{
  expect(await prepareDraftRecipients(db,ws,config())).toEqual([{contact_id:'contact',phone:'573003364305',params:['Ana','Shipping excluded']}])
  expect(queries).toContainEqual(['contacts','eq','workspace_id',ws]);expect(queries).toContainEqual(['contacts','eq','opted_out',false])
 })
 it('requires a matching tag relation while retaining the workspace and opt-out constraints',async()=>{
  const input=config();input.audience_filter={type:'tags',tagIds:[tag]}
  expect(await prepareDraftRecipients(db,ws,input)).toHaveLength(1)
  expect(queries).toContainEqual(['contacts','select','*,contact_tags!inner(tag_id)'])
  expect(queries).toContainEqual(['contacts','in','contact_tags.tag_id',[tag]])
  expect(queries).toContainEqual(['contacts','eq','workspace_id',ws]);expect(queries).toContainEqual(['contacts','eq','opted_out',false])
 })
 it('deduplicates phones and drops invalid, opted-out, foreign and excluded contacts',async()=>{
  contacts.push({...contacts[0],id:'duplicate'},{...contacts[0],id:'foreign',workspace_id:'other',phone:'573003364306'},{...contacts[0],id:'optout',opted_out:true,phone:'573003364307'},{...contacts[0],id:'invalid',phone:'invalid'},{...contacts[0],id:'excluded',phone:'573003364308'})
  excluded=['excluded'];const input=config();input.audience_filter.excludeTagIds=[tag]
  expect(await prepareDraftRecipients(db,ws,input)).toHaveLength(1)
  expect(queries).toContainEqual(['tags','eq','workspace_id',ws]);expect(queries).toContainEqual(['contact_tags','in','tag_id',[tag]])
 })
 it('reads every page and fails instead of truncating an audience above the editor limit',async()=>{
  contacts=Array.from({length:10001},(_,i)=>({...contacts[0],id:String(i),phone:`57300${String(i).padStart(7,'0')}`}))
  await expect(prepareDraftRecipients(db,ws,config())).rejects.toThrow('broadcast_draft_too_large')
 })
 it('bounds the complete UTF-8 parameter payload before writing or queuing it',async()=>{
  contacts=Array.from({length:2000},(_,i)=>({...contacts[0],id:String(i),phone:`57300${String(i).padStart(7,'0')}`}))
  const input=config();input.variables['1']={type:'static',value:'界'.repeat(4096)}
  await expect(prepareDraftRecipients(db,ws,input)).rejects.toThrow('broadcast_draft_too_large')
 })
 it('uses saved segment semantics without widening a missing segment or capped scan',async()=>{
  const input=config();input.audience_filter={type:'segment',segmentId:a};state.segment=contacts
  expect(await prepareDraftRecipients(db,ws,input)).toHaveLength(1);expect(queries).toContainEqual(['contact_segments','eq','workspace_id',ws]);expect(queries).toContainEqual(['contact_segments','eq','id',a])
  count=100001;await expect(prepareDraftRecipients(db,ws,input)).rejects.toThrow('broadcast_draft_too_large')
 })
 it('loads only selected custom fields of the business and keeps fixed neighboring text',async()=>{
  const input=config();input.variables['1']={type:'custom_field',value:a};customRows=[{contact_id:'contact',custom_field_id:a,value:'VIP'}]
  expect((await prepareDraftRecipients(db,ws,input))[0].params).toEqual(['VIP','Shipping excluded'])
  expect(queries).toContainEqual(['custom_fields','eq','workspace_id',ws]);expect(queries).toContainEqual(['contact_custom_values','in','contact_id',['contact']])
 })
 it('does not hide query failures as a zero-recipient audience',async()=>{
  error={message:'private'};await expect(prepareDraftRecipients(db,ws,config())).rejects.toThrow('broadcast_draft_unavailable')
 })
 it('rejects unsupported template media, headers, buttons, incomplete variables and changed content',async()=>{
  expect(await draftTemplate(db,ws,config(),'creator')).toMatchObject({id:'template'})
  template={...template,header_type:'image'};await expect(draftTemplate(db,ws,config(),'creator')).rejects.toThrow('broadcast_draft_template')
  template={...template,header_type:'text',header_content:'{{1}}'};await expect(draftTemplate(db,ws,config(),'creator')).rejects.toThrow('broadcast_draft_template')
  template={...template,header_type:null,header_content:null,buttons:[{url:'https://example.com/{{1}}'}]};await expect(draftTemplate(db,ws,config(),'creator')).rejects.toThrow('broadcast_draft_template')
  template={...template,buttons:null,body_text:'Different'};await expect(draftTemplate(db,ws,config(),'creator')).rejects.toThrow('broadcast_draft_changed')
 })
})
