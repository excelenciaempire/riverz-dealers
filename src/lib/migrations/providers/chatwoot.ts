import {z} from 'zod';
import {isPublicHttpsUrl} from '@/lib/security/url-guard';

export class ChatwootMigrationError extends Error {
  constructor(readonly code:'source_invalid'|'source_changed'|'source_limit'|'source_order_unsupported'){super(code);}
}
const id=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const messageId=id.refine(value=>value<=2147483647);
const field=z.string().max(4096).nullable().optional();
const pageNumber=z.union([id,z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number)]).refine(value=>value<=2147483647);
const contact=z.object({id,account_id:id.optional(),name:field,email:field,phone_number:field});
const contacts=z.object({meta:z.object({count:z.number().int().min(0).max(2147483647),current_page:pageNumber}),payload:z.array(contact).max(15)});
export type ChatwootMigrationContact={sourceId:string;phone:string;name:string;email:string;company:string};
export type ChatwootContactPage={total:number;page:number;next:number|null;contacts:ChatwootMigrationContact[]};

/** Projection only: never retain custom attributes, staff credentials, inbox
 * identifiers or raw provider response bodies. Phone consent is not inferred. */
export function projectChatwootContacts(value:unknown,expected:{accountId:number;page:number;total?:number}):ChatwootContactPage{
  if(!id.safeParse(expected.accountId).success||!id.safeParse(expected.page).success||
    expected.total!==undefined&&(!Number.isInteger(expected.total)||expected.total<0||expected.total>5000))throw new ChatwootMigrationError('source_invalid');
  const parsed=contacts.safeParse(value);if(!parsed.success)throw new ChatwootMigrationError('source_invalid');const data=parsed.data;
  if(data.meta.count>5000)throw new ChatwootMigrationError('source_limit');
  if(data.meta.current_page!==expected.page||expected.total!==undefined&&expected.total!==data.meta.count||
    data.payload.some(row=>row.account_id!==undefined&&row.account_id!==expected.accountId)||new Set(data.payload.map(row=>row.id)).size!==data.payload.length)throw new ChatwootMigrationError('source_changed');
  const expectedRows=Math.min(15,Math.max(0,data.meta.count-(expected.page-1)*15));
  if(data.payload.length!==expectedRows||expected.page>Math.max(1,Math.ceil(data.meta.count/15)))throw new ChatwootMigrationError('source_changed');
  return {total:data.meta.count,page:expected.page,next:expected.page*15<data.meta.count?expected.page+1:null,
    contacts:data.payload.map(row=>({sourceId:String(row.id),phone:row.phone_number?.trim()??'',name:row.name?.trim()??'',email:row.email?.trim()??'',company:''}))};
}

const attachment=z.object({id,file_type:z.string().max(64),data_url:z.string().max(2048),file_size:z.number().int().min(0).max(8*1024*1024).nullable().optional()});
const message=z.object({id:messageId,account_id:id,conversation_id:id,inbox_id:id,message_type:z.number().int().min(0).max(3),private:z.boolean(),
  created_at:z.number().int().min(0).max(4102444800),content:z.string().max(150000).nullable(),content_type:z.string().max(64).optional(),
  attachments:z.array(attachment).max(15).optional(),attachment:z.unknown().optional()});
const messages=z.object({payload:z.array(message).max(20)});
export type ChatwootArchiveMessage={sourceId:string;conversationSourceId:string;inboxSourceId:string;at:string;kind:'incoming'|'outgoing'|'activity'|'template'|'note';
  private:boolean;text:string;sourceFormat:string|null;attachments:Array<{sourceId:string;type:string;referenceUrl:string;bytes:number|null}>};

/** This provider's `before` endpoint returns at most 20 messages ordered by
 * created_at. Refuse non-monotonic IDs rather than skipping them silently.
 * The caller must label observed history and never claim a source snapshot. */
export function projectChatwootMessages(value:unknown,expected:{accountId:number;conversationId:number;inboxId:number;before?:number}){
  if(![expected.accountId,expected.conversationId,expected.inboxId].every(value=>id.safeParse(value).success)||
    expected.before!==undefined&&!messageId.safeParse(expected.before).success)throw new ChatwootMigrationError('source_invalid');
  const parsed=messages.safeParse(value);if(!parsed.success)throw new ChatwootMigrationError('source_invalid');const rows=parsed.data.payload;
  if(rows.some(row=>row.account_id!==expected.accountId||row.conversation_id!==expected.conversationId||row.inbox_id!==expected.inboxId||
    expected.before!==undefined&&row.id>=expected.before))throw new ChatwootMigrationError('source_changed');
  if(rows.some((row,index)=>index>0&&(row.id<=rows[index-1].id||row.created_at<rows[index-1].created_at)))throw new ChatwootMigrationError('source_order_unsupported');
  // Do not silently discard an older provider's undocumented attachment shape.
  if(rows.some(row=>row.attachment!==undefined&&row.attachment!==null&&
    (typeof row.attachment!=='object'||Array.isArray(row.attachment)||Object.keys(row.attachment).length>0)))throw new ChatwootMigrationError('source_invalid');
  const projected:ChatwootArchiveMessage[]=rows.map(row=>({sourceId:String(row.id),conversationSourceId:String(row.conversation_id),inboxSourceId:String(row.inbox_id),
    at:new Date(row.created_at*1000).toISOString(),kind:row.private?'note':(['incoming','outgoing','activity','template'] as const)[row.message_type],private:row.private,text:row.content??'',sourceFormat:row.content_type??null,
    attachments:(row.attachments??[]).map(file=>{
      if(!isPublicHttpsUrl(file.data_url))throw new ChatwootMigrationError('source_invalid');
      return {sourceId:String(file.id),type:file.file_type,referenceUrl:file.data_url,bytes:file.file_size??null};
    })}));
  if(new Set(projected.flatMap(row=>row.attachments.map(file=>file.sourceId))).size!==projected.reduce((count,row)=>count+row.attachments.length,0))throw new ChatwootMigrationError('source_changed');
  // A short page is not proof of account-wide completeness. Fetch an empty
  // page to establish that this endpoint has no earlier observed messages.
  return {messages:projected,nextBefore:rows[0]?.id??null,empty:rows.length===0};
}
