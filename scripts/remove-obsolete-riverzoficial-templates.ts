/** Remove only explicitly superseded riverzoficial templates. Preview by default. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {productTemplates,productTemplateName,RIVERZOFICIAL_WORKSPACE} from './riverzoficial-copy';
for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=/^([A-Z0-9_]+)=(.*)$/.exec(line);if(m)process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
const obsolete=new Set(productTemplates.flatMap(p=>p.aliases.flatMap(name=>[name,`${name}_human_v1`])));
const references=(value:unknown,targets:Set<string>):boolean=>typeof value==='string'?targets.has(value):Array.isArray(value)?value.some(v=>references(v,targets)):value!==null&&typeof value==='object'?Object.values(value).some(v=>references(v,targets)):false;
async function main(){
  const {resolverWabaYToken}=await import('@/lib/templates/create');
  const {deleteMessageTemplate}=await import('@/lib/whatsapp/meta-api');
  const {withAppsecretProof}=await import('@/lib/channels/meta-graph');
  const {data:local,error}=await db.from('message_templates').select('*').eq('workspace_id',RIVERZOFICIAL_WORKSPACE);if(error)throw error;
  const removals=local!.filter(t=>obsolete.has(t.name));
  for(const item of productTemplates)for(const language of ['es','en']as const){
    const keep=local!.find(t=>t.name===productTemplateName(item.key)&&t.language===language);
    if(!keep||keep.body_text!==item[language]||item.fields.some((f,i)=>keep.variable_fields?.[String(i+1)]!==f))throw new Error(`Replacement not verified: ${item.key}/${language}`);
  }
  const targets=new Set([...obsolete,...removals.map(t=>t.id)]);
  const {data:flows,error:fe}=await db.from('automations').select('id').eq('workspace_id',RIVERZOFICIAL_WORKSPACE).is('deleted_at',null);if(fe)throw fe;
  for(const flow of flows??[]){const {data:steps,error:se}=await db.from('automation_steps').select('id,step_config').eq('automation_id',flow.id);if(se)throw se;if(steps?.some(s=>references(s.step_config,targets)))throw new Error(`Obsolete template still referenced by automation ${flow.id}`);}
  const {data:broadcasts,error:be}=await db.from('broadcasts').select('*').eq('workspace_id',RIVERZOFICIAL_WORKSPACE).in('status',['draft','scheduled','sending']);if(be)throw be;
  if(broadcasts?.some(b=>references(b,targets)))throw new Error('Obsolete template referenced by a pending broadcast');
  const owner=local!.find(t=>t.user_id)?.user_id;
  const {wabaId,accessToken}=await resolverWabaYToken(db,RIVERZOFICIAL_WORKSPACE,owner);if(!wabaId||!accessToken)throw new Error('WhatsApp connection unavailable');
  const headers={Authorization:`Bearer ${accessToken}`};
  async function listMeta(){
    const all:Array<{id:string;name:string;language:string;components?:Array<{type:string;text?:string}>}>=[];
    let cursor='';
    do{const url=withAppsecretProof(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100&fields=id,name,language,components${cursor?`&after=${encodeURIComponent(cursor)}`:''}`,accessToken);
      const response=await fetch(url,{headers});const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Meta listing failed');
      all.push(...body.data);cursor=body.paging?.next?body.paging.cursors?.after:'';
      if(body.paging?.next&&!cursor)throw new Error('Missing pagination cursor');
    }while(cursor);return all;
  }
  const remote=await listMeta();
  for(const item of productTemplates)for(const language of ['es','en']as const){if(!remote.some(t=>t.name===productTemplateName(item.key)&&t.language===language&&t.components?.find(c=>c.type==='BODY')?.text===item[language]))throw new Error(`Meta replacement missing: ${item.key}/${language}`);}
  const oldRemote=remote.filter(t=>obsolete.has(t.name));
  mkdirSync('tmp',{recursive:true});const stamp=Date.now();
  writeFileSync(`tmp/riverzoficial-obsolete-backup-${stamp}.json`,JSON.stringify({local:removals,remote:oldRemote},null,2));
  console.log(JSON.stringify({localToDelete:removals.length,metaToDelete:oldRemote.length,keep:20,names:[...new Set(removals.map(t=>t.name))]}));
  if(!process.argv.includes('--apply'))return;
  for(const row of oldRemote){await deleteMessageTemplate({wabaId,accessToken,name:row.name,hsmId:row.id});console.log(JSON.stringify({deletedFromMeta:row.name,language:row.language}));}
  const afterRemote=await listMeta();
  if(afterRemote.some(t=>obsolete.has(t.name)))throw new Error('Meta still lists obsolete templates; local copies retained pending verification');
  for(const row of removals){const {error:de}=await db.from('message_templates').delete().eq('id',row.id).eq('workspace_id',RIVERZOFICIAL_WORKSPACE).eq('name',row.name);if(de)throw de;}
  const {data:after,error:ae}=await db.from('message_templates').select('name,language').eq('workspace_id',RIVERZOFICIAL_WORKSPACE);if(ae)throw ae;
  if(after!.some(t=>obsolete.has(t.name)))throw new Error('Obsolete local templates remain');
  for(const p of productTemplates)for(const lang of ['es','en'])if(!after!.some(t=>t.name===productTemplateName(p.key)&&t.language===lang))throw new Error('Replacement missing after cleanup');
  console.log(JSON.stringify({deletedLocal:removals.length,deletedMeta:oldRemote.length,remaining:after!.length,verified:true}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:JSON.stringify(e));process.exitCode=1;});
