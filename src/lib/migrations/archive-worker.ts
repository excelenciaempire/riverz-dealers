import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {nativeSourceDefinition,nativeSourceErrors} from './native-source-contract';
import {archiveCollection,advanceArchiveCollection,parseArchiveCollection} from './archive-collection';
import {ARCHIVE_MAX_STORAGE_BYTES,ARCHIVE_MAX_FILE_BYTES,archiveStoredFile} from './archive-contract';
import {openArchiveCredential,openArchiveFileReference,sealArchiveFileReference} from './archive-credentials';
import {readChatwootContactConversations,readChatwootHistoryMessages} from './providers/chatwoot-history-client';
import {downloadArchiveFile} from './archive-download';
import {uploadArchiveObject,removeArchiveObjects} from './archive-storage';
const claim=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),receipt_id:z.string().uuid(),source:nativeSourceDefinition,
 credential_ciphertext:z.string().max(20000).nullable(),lease_id:z.string().uuid(),step:z.number().int().min(0),payload:archiveCollection,expires_at:z.string().datetime({offset:true})}).strict();
function code(error:unknown){
 const message=error instanceof Error?error.message:'';
 return message!=='source_expired'&&(nativeSourceErrors as readonly string[]).includes(message)?message:'source_unavailable';
}
function rpcError(message:string):never{
 throw new Error(message==='contact_migration_not_found'?'source_access_revoked':message==='contact_migration_read_only'?'source_read_only':
  message==='native_history_archive_changed'?'source_changed':message==='native_history_archive_limit'?'source_limit':'source_unavailable');
}
/** Fresh authority before EACH source/file/storage operation. Collection is
 * private; no live messages, customer events, provider writes or model calls. */
export async function syncNativeHistoryArchives(db:SupabaseClient){
 const summary={steps:0,failed:0,skipped:0};if(!SHOW_RIVERZ_IMPROVEMENTS)return summary;const deadline=Date.now()+40000;
 for(let round=0;round<8&&Date.now()<deadline;round++){
  const result=await db.rpc('claim_native_history_archives',{p_limit:2});if(result.error)throw new Error('native_history_worker_unavailable');
  const parsed=z.array(claim).max(2).safeParse(result.data);if(!parsed.success||new Set(parsed.data.map(job=>job.id)).size!==parsed.data.length)throw new Error('native_history_worker_unavailable');
  if(parsed.data.length===0)break;
  const outcomes=await Promise.allSettled(parsed.data.map(async job=>{
   const authorize=async()=>{const r=await db.rpc('authorize_native_history_step',{p_id:job.id,p_lease_id:job.lease_id});if(r.error)rpcError(r.error.message);if(r.data!==true)throw new Error('source_changed');};
   try{
    if(Date.parse(job.expires_at)<=Date.now()){summary.skipped++;return;}await authorize();
    const context={workspaceId:job.workspace_id,actorId:job.actor_id,jobId:job.id,receiptId:job.receipt_id,source:job.source};
    let state=parseArchiveCollection(job.payload);
    if(state.phase==='files'){
     const message=state.messages.find(row=>row.attachments.some(file=>file.referenceCiphertext!==null));
     if(!message)state.phase='done';
     else{
      const file=message.attachments.find(file=>file.referenceCiphertext!==null)!,remaining=ARCHIVE_MAX_STORAGE_BYTES-state.storedFiles.reduce((n,file)=>n+file.bytes,0);
      if(remaining<1)throw new Error('source_limit');const url=openArchiveFileReference(context,message.sourceId,file.sourceId,file.referenceCiphertext!);
      await authorize();const downloaded=await downloadArchiveFile(url,file.bytes,Math.min(remaining,ARCHIVE_MAX_FILE_BYTES));
      await authorize();const intent=await db.rpc('register_native_history_object',{p_id:job.id,p_lease_id:job.lease_id,p_message_id:message.sourceId,p_file_id:file.sourceId});
      if(intent.error)rpcError(intent.error.message);const expected=`${job.id}/${job.lease_id}/${file.sourceId}`;if(intent.data!==expected)throw new Error('source_unavailable');
      // Intent remains registered on a lost response/stale lease; eventual
      // exact-path cleanup must not delete a possibly committed live object.
      await authorize();await uploadArchiveObject(expected,downloaded.buffer,downloaded.mime);
      file.referenceCiphertext=null;state.storedFiles.push({messageId:message.sourceId,fileId:file.sourceId,path:expected,mime:downloaded.mime,bytes:downloaded.buffer.length,sha256:createHash('sha256').update(downloaded.buffer).digest('hex')});
      if(state.messages.every(row=>row.attachments.every(file=>file.referenceCiphertext===null)))state.phase='done';
     }
    }else{
     if(job.credential_ciphertext===null)throw new Error('source_credential_unavailable');const token=openArchiveCredential(context,job.credential_ciphertext);
     state=await advanceArchiveCollection(state,{conversations:async(contactId,anchorId)=>{await authorize();return readChatwootContactConversations(job.source,token,{contactId,...(anchorId===undefined?{}:{anchorId})});},
      messages:async(conversationId,inboxId,before)=>{await authorize();return readChatwootHistoryMessages(job.source,token,{conversationId,inboxId,...(before===undefined?{}:{before})});},
      sealFile:(messageId,fileId,url)=>sealArchiveFileReference(context,messageId,fileId,url)});
    }
    state=parseArchiveCollection(state);const saved=await db.rpc('record_native_history_step',{p_id:job.id,p_lease_id:job.lease_id,p_step:job.step,p_payload:state});
    if(saved.error)rpcError(saved.error.message);if(saved.data===true)summary.steps++;else if(saved.data===false)summary.skipped++;else throw new Error('source_unavailable');
   }catch(error){const failed=await db.rpc('fail_native_history_archive',{p_id:job.id,p_lease_id:job.lease_id,p_code:code(error)});
    if(failed.error||typeof failed.data!=='boolean')throw new Error('native_history_worker_unavailable');if(failed.data)summary.failed++;else summary.skipped++;}
  }));
  if(outcomes.some(outcome=>outcome.status==='rejected'))throw new Error('native_history_worker_unavailable');
 }
 return summary;
}
/** Called by authenticated privacy maintenance. Only registered, old,
 * unreferenced paths; never lists or deletes a customer media prefix. */
export async function purgeNativeHistoryStorage(db:SupabaseClient){
 const listed=await db.rpc('list_native_history_orphans',{p_limit:20});const parsed=z.array(z.object({path:archiveStoredFile.shape.path}).strict()).max(20).safeParse(listed.data);
 if(listed.error||!parsed.success)throw new Error('native_history_cleanup_unavailable');if(parsed.data.length===0)return 0;
 try{await removeArchiveObjects(parsed.data.map(row=>row.path));}catch{throw new Error('native_history_cleanup_unavailable');}let removed=0;
 for(const row of parsed.data){const result=await db.rpc('forget_native_history_orphan',{p_path:row.path});if(result.error||typeof result.data!=='boolean')throw new Error('native_history_cleanup_unavailable');if(result.data)removed++;}return removed;
}
