import {z} from 'zod';
import {nativeContactRow} from '../native-source-contract';
import {externalSourceDefinition,type ExternalSourceDefinition} from '../external-source-contract';
const integer=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),text=z.string().max(4096),optionalText=text.nullish();
export class ExternalProjectionError extends Error{constructor(readonly code:'source_invalid'|'source_changed'|'source_limit'){super(code);}}
function invalid():never{throw new ExternalProjectionError('source_invalid');}
/** Multiple different phone/email values remain blank for the existing review;
 * neither a source label nor its opt-in fields prove Riverz transport consent. */
function singleField(fields:Array<{field_code?:string|null;values:Array<{value:unknown}>}>|null|undefined,code:string){
 const values=fields?.filter(field=>field.field_code===code).flatMap(field=>field.values.map(item=>text.safeParse(item.value))).map(item=>item.success?item.data.trim():invalid())??[];
 const unique=[...new Set(values.filter(Boolean))];return unique.length===1?unique[0]:'';
}
const kommoContact=z.object({id:integer,account_id:integer,name:optionalText,is_deleted:z.boolean().optional(),custom_fields_values:z.array(z.object({field_code:z.string().nullable().optional(),values:z.array(z.object({value:z.unknown()})).max(100)})).max(100).nullish()});
export function projectKommoContacts(input:unknown,context:{source:ExternalSourceDefinition;page:number;lastId:number}){
 const source=externalSourceDefinition.parse(context.source);if(source.provider!=='kommo'||!Number.isInteger(context.page)||context.page<1||context.page>201||!Number.isSafeInteger(context.lastId)||context.lastId<0)invalid();
 if(input===null)return {contacts:[],done:true};
 const parsed=z.object({_page:z.number().int().positive(),_embedded:z.object({contacts:z.array(kommoContact).max(25)})}).safeParse(input);
 if(!parsed.success||parsed.data._page!==context.page)invalid();
 let last=context.lastId;
 const contacts=parsed.data._embedded.contacts.map(item=>{
  if(item.account_id!==source.accountId||item.id<=last||item.is_deleted===true)throw new ExternalProjectionError('source_changed');last=item.id;
  return nativeContactRow.parse({sourceId:String(item.id),name:item.name?.trim()??'',phone:singleField(item.custom_fields_values,'PHONE'),email:singleField(item.custom_fields_values,'EMAIL'),company:''});
 });
 return {contacts,done:contacts.length<25};
}
const subscriber=z.object({id:z.string().regex(/^[1-9][0-9]{0,15}$/),page_id:z.string().regex(/^[1-9][0-9]{0,15}$/),name:optionalText,phone:optionalText,whatsapp_phone:optionalText,email:optionalText});
export function projectManyChatContact(input:unknown,context:{accountId:number;subscriberId:number}){
 const parsed=z.object({status:z.literal('success'),data:subscriber}).safeParse(input);
 if(!parsed.success||parsed.data.data.page_id!==String(context.accountId)||parsed.data.data.id!==String(context.subscriberId))invalid();
 const item=parsed.data.data,phones=[...new Set([item.phone,item.whatsapp_phone].map(value=>value?.trim()??'').filter(Boolean))];
 return nativeContactRow.parse({sourceId:item.id,name:item.name?.trim()??'',phone:phones.length===1?phones[0]:'',email:item.email?.trim()??'',company:''});
}
export function checkManyChatPage(input:unknown,accountId:number){
 const parsed=z.object({status:z.literal('success'),data:z.object({id:integer})}).safeParse(input);
 if(!parsed.success||parsed.data.data.id!==accountId)invalid();
}
