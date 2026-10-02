import {z} from 'zod';
import {isPublicHttpsUrl} from '@/lib/security/url-guard';
const origin=z.string().trim().max(120).refine(value=>{
  const url=isPublicHttpsUrl(value);return !!url&&!url.hostname.includes(':')&&url.pathname==='/'&&!url.search&&!url.hash;
}).transform(value=>new URL(value).origin);
export const nativeSourceDefinition=z.object({provider:z.literal('chatwoot'),origin,accountId:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict();
export const nativeSourceStart=nativeSourceDefinition.extend({id:z.string().uuid(),token:z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/)}).strict();
export type NativeSourceDefinition=z.infer<typeof nativeSourceDefinition>;
export type NativeSourceStart=z.infer<typeof nativeSourceStart>;
export const nativeSourceRead=z.object({id:z.string().uuid(),after:z.number().int().min(0).max(5000).default(0)}).strict();
export const nativeContactRow=z.object({sourceId:z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value=>Number(value)<=Number.MAX_SAFE_INTEGER),
  phone:z.string().max(4096),name:z.string().max(4096),email:z.string().max(4096),company:z.string().max(4096)}).strict();
export const nativeSourceErrors=['source_invalid','source_changed','source_limit','source_order_unsupported','source_auth','source_rate_limit','source_timeout','source_unavailable','source_credential_unavailable','source_expired','source_read_only','source_access_revoked'] as const;
export const nativeSourceSnapshot=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),source:nativeSourceDefinition,
  state:z.enum(['queued','fetching','ready','empty','failed','expired','cancelled']),total:z.number().int().min(0).max(5000).nullable(),collected:z.number().int().min(0).max(5000),
  created_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),updated_at:z.string().datetime({offset:true}),error:z.enum(nativeSourceErrors).nullable(),
  rows:z.array(nativeContactRow).max(25),next:z.number().int().min(1).max(4999).nullable(),
}).strict().superRefine((value,ctx)=>{
  if(value.collected>(value.total??5000)||value.total===null&&value.collected!==0||value.state==='ready'&&(!value.total||value.collected!==value.total)||
    value.state==='empty'&&(value.total!==0||value.collected!==0)||value.state!=='ready'&&(value.rows.length>0||value.next!==null)||
    Date.parse(value.expires_at)<=Date.parse(value.created_at)||new Set(value.rows.map(row=>row.sourceId)).size!==value.rows.length||
    value.next!==null&&(value.rows.length===0||value.next>=(value.total??0)))ctx.addIssue({code:'custom',message:'native_source_snapshot_invalid'});
});
export type NativeSourceSnapshot=z.infer<typeof nativeSourceSnapshot>;
export function nativeSourceLabel(definition:NativeSourceDefinition){
  const value=nativeSourceDefinition.parse(definition);return `${value.origin}#${value.accountId}`;
}
