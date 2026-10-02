import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ContactMigrationError,prepareContactMigration} from './contact-import';
import {externalSourceDefinition,externalSourceStart,externalSourceSnapshot,externalSourceLabel,type ExternalSourceSnapshot} from './external-source-contract';
import {externalCredentialFingerprint,sealExternalCredential} from './external-credentials';
import {nativeSourceRead,nativeContactRow} from './native-source-contract';
import {MIGRATION_MAX_BYTES} from './contact-preview';

function scope(workspaceId:string,actorId:string){if(![workspaceId,actorId].every(value=>z.string().uuid().safeParse(value).success))throw new ContactMigrationError('invalid');}
function failure(message:string):never{
  const codes:Record<string,ContactMigrationError['code']>={invalid_external_contact_migration:'invalid',external_contact_migration_not_found:'notFound',external_contact_migration_changed:'changed',external_contact_migration_limit:'limit',
    contact_migration_not_found:'notFound',contact_migration_read_only:'readOnly'};
  throw new ContactMigrationError(codes[message]??'unavailable');
}
function snapshot(data:unknown,workspaceId:string,actorId:string,id:string,after=0):ExternalSourceSnapshot{
  const parsed=externalSourceSnapshot.safeParse(data);
  if(!parsed.success||parsed.data.id!==id||parsed.data.workspace_id!==workspaceId||parsed.data.actor_id!==actorId)throw new ContactMigrationError('unavailable');
  const value=parsed.data;
  if(value.state==='ready'&&(value.rows.length!==Math.min(25,Math.max(0,value.collected-after))||value.next!==(after+value.rows.length<value.collected?after+value.rows.length:null)))throw new ContactMigrationError('unavailable');
  return value;
}
export async function startExternalContactSource(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=externalSourceStart.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
  const {id,token,source}=parsed.data,context={workspaceId,actorId,jobId:id,source};
  const result=await db.rpc('create_external_contact_migration',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:id,p_source:source,
    p_fingerprint:externalCredentialFingerprint(context,token),p_ciphertext:sealExternalCredential(context,token)});
  if(result.error)failure(result.error.message);const saved=snapshot(result.data,workspaceId,actorId,id);
  if(JSON.stringify(saved.source)!==JSON.stringify(source))throw new ContactMigrationError('unavailable');return saved;
}
export async function readExternalContactSource(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=nativeSourceRead.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
  const {id,after}=parsed.data,result=await db.rpc('read_external_contact_migration',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:id,p_after:after});
  if(result.error)failure(result.error.message);return snapshot(result.data,workspaceId,actorId,id,after);
}
export async function cancelExternalContactSource(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=z.object({id:z.string().uuid()}).strict().safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
  const result=await db.rpc('cancel_external_contact_migration',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:parsed.data.id});
  if(result.error)failure(result.error.message);return snapshot(result.data,workspaceId,actorId,parsed.data.id);
}
export const externalContactReview=z.object({id:z.string().uuid(),reviewId:z.string().uuid()}).strict().refine(value=>value.id!==value.reviewId);
/** Only service-side projected contacts enter the existing review. A browser
 * cannot replace fetched rows or bypass its independent human confirmation. */
export async function prepareExternalContactReview(db:SupabaseClient,workspaceId:string,actorId:string,input:unknown){
  scope(workspaceId,actorId);const parsed=externalContactReview.safeParse(input);if(!parsed.success)throw new ContactMigrationError('invalid');
  const {id,reviewId}=parsed.data,result=await db.rpc('read_external_contact_payload',{p_workspace_id:workspaceId,p_actor_id:actorId,p_id:id});
  if(result.error)failure(result.error.message);
  const payload=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),source:externalSourceDefinition,total:z.number().int().min(1).max(5000),rows:z.array(nativeContactRow).min(1).max(5000)}).strict().safeParse(result.data);
  if(!payload.success||payload.data.id!==id||payload.data.workspace_id!==workspaceId||payload.data.actor_id!==actorId||payload.data.total!==payload.data.rows.length||
    new Set(payload.data.rows.map(row=>row.sourceId)).size!==payload.data.total)throw new ContactMigrationError('unavailable');
  const value=payload.data,fields=['sourceId','phone','name','email','company'] as const;
  // This CSV is never a spreadsheet download: the strict server CSV reader
  // treats formulas as literal text, preserves quotes/newlines and UTF-8.
  const cell=(text:string)=>'"'+text.replaceAll('"','""')+'"';
  const csv=[fields.join(','),...value.rows.map(row=>fields.map(field=>cell(row[field])).join(','))].join('\n');
  if(Buffer.byteLength(csv,'utf8')>MIGRATION_MAX_BYTES)throw new ContactMigrationError('limit');
  return prepareContactMigration(db,workspaceId,actorId,{id:reviewId,provider:value.source.provider,account:externalSourceLabel(value.source),csv,mapping:{sourceId:0,phone:1,name:2,email:3,company:4}},id,'external');
}
