import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {externalSourceDefinition,externalOpaqueCursor} from './external-source-contract';
import {openExternalCredential} from './external-credentials';
import {NativeSourceError} from './providers/chatwoot-client';
import {readExternalContactPage} from './providers/external-client';
const claim=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),source:externalSourceDefinition,
  credential_ciphertext:z.string().max(20000),lease_id:z.string().uuid(),last_id:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),page:z.number().int().min(1).max(201),total:z.number().int().min(0).max(5000).nullable(),collected:z.number().int().min(0).max(5000),expires_at:z.string().datetime({offset:true}),source_cursor:externalOpaqueCursor.nullable().optional()}).strict()
  .refine(value=>value.total===null&&(value.source.provider==='kommo'?value.collected===(value.page-1)*25&&value.source_cursor==null:value.source.provider==='manychat'?value.collected===value.page-1&&value.page<=value.source.subscriberIds.length&&value.source_cursor==null:value.page===1?value.collected===0&&value.source_cursor==null:!!value.source_cursor&&value.collected>0&&value.collected<=(value.page-1)*25));
/** Bounded read-only work. Each new page gets a new lease and a fresh current
 * authority check; no provider writes, contacts, model calls or sends occur. */
export async function syncExternalContactSources(db:SupabaseClient){
  const summary={pages:0,failed:0,skipped:0};if(!SHOW_RIVERZ_IMPROVEMENTS)return summary;
  const deadline=Date.now()+40000;
  for(let round=0;round<8&&Date.now()<deadline;round++){
    const result=await db.rpc('claim_external_contact_migrations',{p_limit:2});
    if(result.error)throw new Error('external_contact_worker_unavailable');
    const parsed=z.array(claim).max(2).safeParse(result.data);
    if(!parsed.success||new Set(parsed.data.map(job=>job.id)).size!==parsed.data.length)throw new Error('external_contact_worker_unavailable');
    if(parsed.data.length===0)break;
    const outcomes=await Promise.allSettled(parsed.data.map(async job=>{
      try{
        if(Date.parse(job.expires_at)<=Date.now()){summary.skipped++;return;}
        const authorization=await db.rpc('authorize_external_contact_page',{p_id:job.id,p_lease_id:job.lease_id});
        if(authorization.error)throw new Error(authorization.error.message==='contact_migration_not_found'?'source_access_revoked':authorization.error.message==='contact_migration_read_only'?'source_read_only':'source_unavailable');
        if(authorization.data!==true){summary.skipped++;return;}
        const token=openExternalCredential({workspaceId:job.workspace_id,actorId:job.actor_id,jobId:job.id,source:job.source},job.credential_ciphertext);
        const cursorProvider=job.source.provider==='gorgias'||job.source.provider==='zendesk';
        const page=await readExternalContactPage(job.source,token,{page:job.page,collected:job.collected,lastId:job.last_id,...(cursorProvider?{sourceCursor:job.source_cursor??null}:{})});
        if(cursorProvider&&(!('sourceCursor' in page)||page.done!==(page.sourceCursor===null)))throw new NativeSourceError('source_invalid');
        const saved=await db.rpc(cursorProvider?'record_external_cursor_contact_page':'record_external_contact_page',{p_id:job.id,p_lease_id:job.lease_id,p_page:job.page,p_done:page.done,p_rows:page.contacts,
          ...(cursorProvider?{p_cursor:job.source_cursor??null,p_next_cursor:'sourceCursor' in page?page.sourceCursor:null}:{})});
        if(saved.error)throw new Error(saved.error.message==='external_contact_migration_changed'?'source_changed':saved.error.message==='external_contact_migration_limit'?'source_limit':
          saved.error.message==='contact_migration_not_found'?'source_access_revoked':saved.error.message==='contact_migration_read_only'?'source_read_only':'source_unavailable');
        if(saved.data===true)summary.pages++;else if(saved.data===false)summary.skipped++;else throw new Error('source_unavailable');
      }catch(error){
        const code=error instanceof NativeSourceError?error.code:error instanceof Error&&['source_credential_unavailable','source_changed','source_limit','source_access_revoked','source_read_only'].includes(error.message)?error.message:'source_unavailable';
        const failed=await db.rpc('fail_external_contact_migration',{p_id:job.id,p_lease_id:job.lease_id,p_code:code});
        if(failed.error||typeof failed.data!=='boolean')throw new Error('external_contact_worker_unavailable');
        if(failed.data)summary.failed++;else summary.skipped++;
      }
    }));
    if(outcomes.some(outcome=>outcome.status==='rejected'))throw new Error('external_contact_worker_unavailable');
  }
  return summary;
}
