import {z} from 'zod';
import {nativeContactRow,nativeSourceErrors} from './native-source-contract';
const accountId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const externalToken=z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
export const externalSourceDefinition=z.discriminatedUnion('provider',[
  z.object({provider:z.literal('kommo'),origin:z.string().max(120).regex(/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kommo\.com$/),accountId}).strict(),
  z.object({provider:z.literal('manychat'),origin:z.literal('https://api.manychat.com'),accountId,
    subscriberIds:z.array(accountId).min(1).max(100).refine(ids=>new Set(ids).size===ids.length)}).strict(),
  z.object({provider:z.literal('gorgias'),origin:z.string().max(120).regex(/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.gorgias\.com$/)}).strict(),
  z.object({provider:z.literal('zendesk'),origin:z.string().max(120).regex(/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.zendesk\.com$/)}).strict(),
]);
export const externalOpaqueCursor=z.string().min(1).max(1024).regex(/^[A-Za-z0-9+/=_-]+$/);
export const externalSourceStart=z.object({id:z.string().uuid(),source:externalSourceDefinition,token:externalToken}).strict();
export type ExternalSourceDefinition=z.infer<typeof externalSourceDefinition>;
export const externalSourceSnapshot=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),source:externalSourceDefinition,
 state:z.enum(['queued','fetching','ready','empty','failed','expired','cancelled']),total:z.number().int().min(0).max(5000).nullable(),collected:z.number().int().min(0).max(5000),
 created_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),updated_at:z.string().datetime({offset:true}),error:z.enum(nativeSourceErrors).nullable(),
 rows:z.array(nativeContactRow).max(25),next:z.number().int().min(1).max(4999).nullable(),
}).strict().superRefine((v,ctx)=>{
 if(v.collected>(v.total??5000)||v.state==='ready'&&(!v.total||v.collected!==v.total)||v.state==='empty'&&(v.total!==0||v.collected!==0)||
  v.state!=='ready'&&(v.rows.length>0||v.next!==null)||Date.parse(v.expires_at)<=Date.parse(v.created_at)||new Set(v.rows.map(row=>row.sourceId)).size!==v.rows.length||
  v.next!==null&&(v.rows.length===0||v.next>=(v.total??0))||v.source.provider==='manychat'&&v.collected>v.source.subscriberIds.length)ctx.addIssue({code:'custom',message:'external_source_snapshot_invalid'});
});
export type ExternalSourceSnapshot=z.infer<typeof externalSourceSnapshot>;
export function externalSourceLabel(source:ExternalSourceDefinition){const value=externalSourceDefinition.parse(source);return 'accountId' in value?`${value.origin}#${value.accountId}`:value.origin;}
