import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readMigrationCsv,previewContactMigration,MigrationPreviewError} from './contact-preview';
import {contactMigrationPreparation,contactMigrationConfirmation,contactMigrationRead,contactMigrationSnapshot,contactMigrationResults,type ContactMigrationSnapshot} from './contact-import-contract';

export class ContactMigrationError extends Error {constructor(readonly code:'invalid'|'notFound'|'changed'|'expired'|'readOnly'|'limit'|'unavailable'){super(code);}}
function scope(workspaceId:string,actorId:string){if(![workspaceId,actorId].every(id=>z.string().uuid().safeParse(id).success))throw new ContactMigrationError('invalid');}
function failure(message:string):never{
  const codes:Record<string,ContactMigrationError['code']>={invalid_contact_migration:'invalid',contact_migration_not_found:'notFound',contact_migration_changed:'changed',contact_migration_expired:'expired',contact_migration_read_only:'readOnly',contact_migration_limit:'limit',invalid_external_contact_migration:'invalid',external_contact_migration_not_found:'notFound',external_contact_migration_changed:'changed',invalid_native_contact_migration:'invalid',native_contact_migration_not_found:'notFound',native_contact_migration_changed:'changed'};
  throw new ContactMigrationError(codes[message]??'unavailable');
}
function snapshot(value:unknown,workspaceId:string,actorId:string,id:string):ContactMigrationSnapshot{
  const parsed=contactMigrationSnapshot.safeParse(value);
  if(!parsed.success||parsed.data.workspace_id!==workspaceId||parsed.data.actor_id!==actorId||parsed.data.id!==id)throw new ContactMigrationError('unavailable');
  return parsed.data;
}
export async function prepareContactMigration(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown,nativeJobId?:string,nativeKind:'native'|'external'='native'){
  scope(workspaceId,actorId);const parsed=contactMigrationPreparation.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
  if(nativeJobId!==undefined&&!z.string().uuid().safeParse(nativeJobId).success)throw new ContactMigrationError('invalid');
  if(!['native','external'].includes(nativeKind))throw new ContactMigrationError('invalid');
  const value=parsed.data;
  let preview:ReturnType<typeof previewContactMigration>;
  try{preview=previewContactMigration({...value,...readMigrationCsv(value.csv)});}
  catch(error){if(error instanceof MigrationPreviewError)throw new ContactMigrationError('invalid');throw error;}
  // Canonical ordered input binds retries to the exact CSV, mapping and source.
  const hash=createHash('sha256').update(JSON.stringify([value.provider,value.account,value.csv,
    value.mapping.sourceId,value.mapping.phone,value.mapping.name,value.mapping.email,value.mapping.company])).digest('hex');
  const result=nativeJobId!==undefined?await db.rpc(nativeKind==='external'?'prepare_external_contact_review':'prepare_native_contact_review',{p_workspace_id:workspaceId,p_actor_id:actorId,p_job_id:nativeJobId,p_id:value.id,p_input_hash:hash,p_rows:preview.rows}):
    await db.rpc('prepare_contact_migration',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:value.id,p_provider:value.provider,p_account:value.account,p_input_hash:hash,p_rows:preview.rows});
  if(result.error)failure(result.error.message);
  const saved=snapshot(result.data,workspaceId,actorId,value.id);
  if(saved.provider!==value.provider||saved.account!==value.account||saved.counts.total!==preview.rows.length)throw new ContactMigrationError('unavailable');
  return saved;
}
export async function confirmContactMigration(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=contactMigrationConfirmation.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');const value=parsed.data;
  const result=await db.rpc('confirm_contact_migration',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:value.id,p_revision:value.revision,p_confirmed:value.confirmed});
  if(result.error)failure(result.error.message);const saved=snapshot(result.data,workspaceId,actorId,value.id);
  if(saved.state!=='completed'||saved.revision!==value.revision)throw new ContactMigrationError('unavailable');return saved;
}
export async function readContactMigration(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=contactMigrationRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');const value=parsed.data;
  const result=await db.rpc('read_contact_migration',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:value.id,p_after:value.after});if(result.error)failure(result.error.message);
  const saved=snapshot(result.data,workspaceId,actorId,value.id);
  if(saved.rows.length&&saved.rows[0].row!==Math.max(2,value.after+1)||saved.state==='prepared'&&value.after<saved.counts.total+1&&!saved.rows.length)throw new ContactMigrationError('unavailable');
  return saved;
}
export async function readContactMigrationResults(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=contactMigrationRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');const value=parsed.data;
  const result=await db.rpc('read_contact_migration_results',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:value.id,p_after:value.after});if(result.error)failure(result.error.message);
  const saved=contactMigrationResults.safeParse(result.data);
  if(!saved.success||saved.data.workspace_id!==workspaceId||saved.data.actor_id!==actorId||saved.data.id!==value.id||
    saved.data.rows.length&&saved.data.rows[0].row!==Math.max(2,value.after+1)||saved.data.total+1>value.after&&!saved.data.rows.length)throw new ContactMigrationError('unavailable');
  return saved.data;
}
