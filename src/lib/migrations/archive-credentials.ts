import 'server-only';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {encrypt,decrypt} from '@/lib/channels/encryption';
import {isPublicHttpsUrl} from '@/lib/security/url-guard';
import {nativeSourceDefinition,nativeSourceStart,type NativeSourceDefinition} from './native-source-contract';
import {archiveSourceId,archiveMessageId} from './archive-contract';
type Context={workspaceId:string;actorId:string;jobId:string;receiptId:string;source:NativeSourceDefinition};
const scope=z.object({workspaceId:z.string().uuid(),actorId:z.string().uuid(),jobId:z.string().uuid(),receiptId:z.string().uuid(),source:nativeSourceDefinition}).strict();
const tokenEnvelope=z.object({purpose:z.literal('native_history_token'),scope,token:nativeSourceStart.shape.token}).strict();
const fileEnvelope=z.object({purpose:z.literal('native_history_file'),scope,messageId:archiveMessageId,fileId:archiveSourceId,
  url:z.string().max(2048).refine(value=>!!isPublicHttpsUrl(value))}).strict();
function fingerprint(value:unknown){
  const key=process.env.ENCRYPTION_KEY;if(!key||!/^[a-f0-9]{64}$/i.test(key))throw new Error('source_credential_unavailable');
  return createHmac('sha256',Buffer.from(key,'hex')).update('riverz:native-history:v1\0').update(JSON.stringify(value)).digest('hex');
}
function open(ciphertext:string):unknown{
  if(typeof ciphertext!=='string'||ciphertext.length>20000||!/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/.test(ciphertext))throw new Error('invalid');
  return JSON.parse(decrypt(ciphertext));
}
function same(left:unknown,right:Context){return JSON.stringify(left)===JSON.stringify(scope.parse(right));}
export function sealArchiveCredential(context:Context,token:string){
  const value=tokenEnvelope.parse({purpose:'native_history_token',scope:context,token});return {ciphertext:encrypt(JSON.stringify(value)),fingerprint:fingerprint(value)};
}
export function openArchiveCredential(context:Context,ciphertext:string){
  try{const value=tokenEnvelope.parse(open(ciphertext));if(!same(value.scope,context))throw new Error('invalid');return value.token;}
  catch{throw new Error('source_credential_unavailable');}
}
export function sealArchiveFileReference(context:Context,messageId:string,fileId:string,url:string){
  const value=fileEnvelope.parse({purpose:'native_history_file',scope:context,messageId,fileId,url});return encrypt(JSON.stringify(value));
}
export function openArchiveFileReference(context:Context,messageId:string,fileId:string,ciphertext:string){
  try{const value=fileEnvelope.parse(open(ciphertext));if(!same(value.scope,context)||value.messageId!==messageId||value.fileId!==fileId)throw new Error('invalid');return value.url;}
  catch{throw new Error('source_credential_unavailable');}
}
