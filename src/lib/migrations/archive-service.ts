import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ContactMigrationError} from './contact-import';
import {archiveStart,archiveRead,archiveConfirm,archiveSnapshot,archiveMessagesRead,archiveFileRead,archiveMessage,archiveConversation,archiveTarget,archiveStoredFile,archiveMessagesPage} from './archive-contract';
import {sealArchiveCredential} from './archive-credentials';
import {downloadArchiveObject} from './archive-storage';
function scope(workspaceId:string,actorId:string){if(![workspaceId,actorId].every(value=>z.string().uuid().safeParse(value).success))throw new ContactMigrationError('invalid');}
function failure(message:string):never{
 const codes:Record<string,ContactMigrationError['code']>={invalid_native_history_archive:'invalid',native_history_archive_not_found:'notFound',native_history_archive_changed:'changed',native_history_archive_limit:'limit',contact_migration_not_found:'notFound',contact_migration_read_only:'readOnly'};
 throw new ContactMigrationError(codes[message]??'unavailable');
}
function snapshot(data:unknown,workspaceId:string,actorId:string,id:string){const parsed=archiveSnapshot.safeParse(data);if(!parsed.success||parsed.data.id!==id||parsed.data.workspace_id!==workspaceId||parsed.data.actor_id!==actorId)throw new ContactMigrationError('unavailable');return parsed.data;}
export async function startNativeHistoryArchive(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 scope(workspaceId,actorId);const parsed=archiveStart.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
 const {id,receiptId,after,token,...source}=parsed.data,encrypted=sealArchiveCredential({workspaceId,actorId,jobId:id,receiptId,source},token);
 const result=await db.rpc('create_native_history_archive',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:id,p_receipt_id:receiptId,p_source:source,p_after:after,p_fingerprint:encrypted.fingerprint,p_ciphertext:encrypted.ciphertext});
 if(result.error)failure(result.error.message);const value=snapshot(result.data,workspaceId,actorId,id);
 if(value.receipt_id!==receiptId||JSON.stringify(value.source)!==JSON.stringify(source))throw new ContactMigrationError('unavailable');return value;
}
export async function readNativeHistoryArchive(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 scope(workspaceId,actorId);const parsed=archiveRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
 const result=await db.rpc('read_native_history_archive',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:parsed.data.id});if(result.error)failure(result.error.message);return snapshot(result.data,workspaceId,actorId,parsed.data.id);
}
export async function confirmNativeHistoryArchive(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 scope(workspaceId,actorId);const parsed=archiveConfirm.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
 const result=await db.rpc('confirm_native_history_archive',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:parsed.data.id,p_revision:parsed.data.revision});if(result.error)failure(result.error.message);
 const value=snapshot(result.data,workspaceId,actorId,parsed.data.id);if(value.state!=='confirmed'||value.revision!==parsed.data.revision)throw new ContactMigrationError('unavailable');return value;
}
export async function cancelNativeHistoryArchive(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown,deleteConfirmed=false){
 scope(workspaceId,actorId);const parsed=archiveRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
 const result=await db.rpc('cancel_native_history_archive',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:parsed.data.id,p_delete:deleteConfirmed});if(result.error)failure(result.error.message);return snapshot(result.data,workspaceId,actorId,parsed.data.id);
}
export async function readNativeHistoryMessages(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 scope(workspaceId,actorId);const parsed=archiveMessagesRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');const {id,after}=parsed.data;
 const result=await db.rpc('read_native_history_messages',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:id,p_after:after});if(result.error)failure(result.error.message);
 const parsedPage=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/),total:z.number().int().min(0).max(10000),
  rows:z.array(z.object({message:archiveMessage,conversation:archiveConversation,target:archiveTarget,files:z.array(archiveStoredFile).max(15)}).strict()).max(20),next:z.number().int().min(1).max(10000).nullable()}).strict().safeParse(result.data);
 if(!parsedPage.success||parsedPage.data.id!==id||parsedPage.data.workspace_id!==workspaceId||parsedPage.data.actor_id!==actorId)throw new ContactMigrationError('unavailable');const page=parsedPage.data;
 if(page.rows.length!==Math.min(20,Math.max(0,page.total-after))||page.next!== (after+page.rows.length<page.total?after+page.rows.length:null)||new Set(page.rows.map(row=>row.message.sourceId)).size!==page.rows.length)throw new ContactMigrationError('unavailable');
 const rows=page.rows.map(row=>{
  const {attachments,...message}=row.message;
  if(row.target.sourceId!==row.conversation.contactSourceId||row.conversation.sourceId!==message.conversationSourceId||row.conversation.inboxSourceId!==message.inboxSourceId||
   attachments.some(file=>file.referenceCiphertext!==null)||attachments.length!==row.files.length||row.files.some(file=>file.messageId!==message.sourceId||!file.path.startsWith(`${id}/`)||!attachments.some(a=>a.sourceId===file.fileId)))throw new ContactMigrationError('unavailable');
  return {contactId:row.target.contactId,contactSourceId:row.target.sourceId,conversation:row.conversation,message,files:row.files.map(file=>({fileId:file.fileId,type:attachments.find(a=>a.sourceId===file.fileId)!.type,mime:file.mime,bytes:file.bytes}))};
 });return archiveMessagesPage.parse({id,revision:page.revision,total:page.total,rows,next:page.next});
}
export async function readNativeHistoryFile(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
 scope(workspaceId,actorId);const parsed=archiveFileRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');const {id,fileId}=parsed.data;
 const args={p_workspace_id:workspaceId,p_actor_id:actorId,p_id:id,p_file_id:fileId};const result=await db.rpc('read_native_history_file',args);if(result.error)failure(result.error.message);
 const file=archiveStoredFile.safeParse(result.data);if(!file.success||file.data.fileId!==fileId||!file.data.path.startsWith(`${id}/`))throw new ContactMigrationError('unavailable');
 let downloaded:Awaited<ReturnType<typeof downloadArchiveObject>>;try{downloaded=await downloadArchiveObject(file.data);}catch{throw new ContactMigrationError('unavailable');}
 // A cancellation, contact deletion or role change during storage I/O must
 // prevent bytes from being released after the first authority check.
 const recheck=await db.rpc('read_native_history_file',args);if(recheck.error)failure(recheck.error.message);
 if(JSON.stringify(recheck.data)!==JSON.stringify(result.data))throw new ContactMigrationError('changed');return downloaded;
}
