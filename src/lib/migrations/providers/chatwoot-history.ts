import {z} from 'zod';
import {ChatwootMigrationError,projectChatwootMessages,type ChatwootArchiveMessage} from './chatwoot';
const id=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const at=z.number().int().min(0).max(4102444800);
const context=z.object({accountId:id,contactId:id,anchorId:id.optional()}).strict();
const conversation=z.object({id,account_id:id.optional(),inbox_id:id,status:z.enum(['open','resolved','pending','snoozed']),created_at:at,
  channel:z.string().max(128).nullable().optional(),
  meta:z.object({sender:z.object({id}),channel:z.string().max(128).nullable().optional()}),
  contact_inbox:z.object({contact_id:id,inbox_id:id}).nullable().optional()});
export type ChatwootArchiveConversation={sourceId:string;contactSourceId:string;inboxSourceId:string;state:'open'|'resolved'|'pending'|'snoozed';at:string;sourceChannel:string|null};
/** Current Chatwoot initially returns at most 25 conversations sorted by last
 * activity, not all history. With conversation_id it returns [older, anchor,
 * newer] using creation order. The collector must walk BOTH directions. */
export function projectChatwootContactConversations(value:unknown,expected:{accountId:number;contactId:number;anchorId?:number}){
  const parsedContext=context.safeParse(expected);if(!parsedContext.success)throw new ChatwootMigrationError('source_invalid');
  if(value&&typeof value==='object'&&'payload'in value&&Array.isArray(value.payload)&&value.payload.length>25)throw new ChatwootMigrationError('source_limit');
  const parsed=z.object({payload:z.array(conversation).max(25)}).safeParse(value);if(!parsed.success)throw new ChatwootMigrationError('source_invalid');
  const rows=parsed.data.payload,ctx=parsedContext.data;
  if(new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>row.account_id!==undefined&&row.account_id!==ctx.accountId||row.meta.sender.id!==ctx.contactId||
    row.contact_inbox&&(row.contact_inbox.contact_id!==ctx.contactId||row.contact_inbox.inbox_id!==row.inbox_id)))throw new ChatwootMigrationError('source_changed');
  let anchorIndex=-1;
  if(ctx.anchorId!==undefined){
    anchorIndex=rows.findIndex(row=>row.id===ctx.anchorId);
    if(rows.length>3||anchorIndex===-1||anchorIndex>1||rows.length-anchorIndex>2)throw new ChatwootMigrationError('source_changed');
    if(rows.some((row,index)=>index>0&&row.created_at<rows[index-1].created_at))throw new ChatwootMigrationError('source_order_unsupported');
  }
  const projected:ChatwootArchiveConversation[]=rows.map(row=>({sourceId:String(row.id),contactSourceId:String(ctx.contactId),inboxSourceId:String(row.inbox_id),state:row.status,
    at:new Date(row.created_at*1000).toISOString(),sourceChannel:row.channel??row.meta.channel??null}));
  return {conversations:projected,initialSample:ctx.anchorId===undefined,previous:anchorIndex<0?null:projected[anchorIndex-1]?.sourceId??null,
    next:anchorIndex<0?null:projected[anchorIndex+1]?.sourceId??null};
}
export type ChatwootHistoryMessage=ChatwootArchiveMessage&{sourceDeleted:boolean};
/** Respect source deletion markers; never resurrect text or attachments from
 * an older or inconsistent deleted response. Raw staff fields are discarded. */
export function projectChatwootHistoryMessages(value:unknown,expected:Parameters<typeof projectChatwootMessages>[1]){
  const parsed=z.object({payload:z.array(z.object({id,content_attributes:z.object({deleted:z.boolean().optional()}).nullable().optional()}).passthrough()).max(20)}).safeParse(value);
  if(!parsed.success)throw new ChatwootMigrationError('source_invalid');
  const rows=parsed.data.payload;
  const projected=projectChatwootMessages({payload:rows.map(row=>row.content_attributes?.deleted===true?{...row,content:'',attachments:[],attachment:{}}:row)},expected);
  const messages:ChatwootHistoryMessage[]=projected.messages.map((row,index)=>({...row,sourceDeleted:rows[index].content_attributes?.deleted===true}));
  return {...projected,messages};
}
