import 'server-only';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {encrypt,decrypt} from '@/lib/channels/encryption';
import {externalSourceDefinition,externalToken,type ExternalSourceDefinition} from './external-source-contract';
const envelope=z.object({workspace_id:z.string().uuid(),actor_id:z.string().uuid(),job_id:z.string().uuid(),source:externalSourceDefinition,
  token:externalToken}).strict();
type Context={workspaceId:string;actorId:string;jobId:string;source:ExternalSourceDefinition};
export function externalCredentialFingerprint(context:Context,token:string){
  const value=envelope.parse({workspace_id:context.workspaceId,actor_id:context.actorId,job_id:context.jobId,source:context.source,token});
  const key=process.env.ENCRYPTION_KEY;if(!key||!/^[0-9a-fA-F]{64}$/.test(key))throw new Error('source_credential_unavailable');
  return createHmac('sha256',Buffer.from(key,'hex')).update('riverz:external-migration:v1\0').update(JSON.stringify(value)).digest('hex');
}
/** Authenticated encryption binds credentials to the initiating actor, tenant,
 * job, exact origin and source account. Legacy CBC is not admitted. */
export function sealExternalCredential(context:Context,token:string){
  const value=envelope.parse({workspace_id:context.workspaceId,actor_id:context.actorId,job_id:context.jobId,source:context.source,token});
  return encrypt(JSON.stringify(value));
}
export function openExternalCredential(context:Context,ciphertext:string):string{
  try{
    const source=externalSourceDefinition.parse(context.source);
    if(typeof ciphertext!=='string'||ciphertext.length>20000||!/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/.test(ciphertext))throw new Error('invalid');
    const value=envelope.parse(JSON.parse(decrypt(ciphertext)));
    if(value.workspace_id!==context.workspaceId||value.actor_id!==context.actorId||value.job_id!==context.jobId||JSON.stringify(value.source)!==JSON.stringify(source))throw new Error('invalid');
    return value.token;
  }catch{throw new Error('source_credential_unavailable');}
}
