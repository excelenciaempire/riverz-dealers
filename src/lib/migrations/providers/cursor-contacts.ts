import {z} from 'zod';
import {nativeContactRow} from '../native-source-contract';
import {externalOpaqueCursor} from '../external-source-contract';
import {ExternalProjectionError} from './external-contacts';
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER),text=z.string().max(4096).nullish();
const channel=z.object({type:z.string().max(80),address:z.string().max(4096)});
const customer=z.object({id,name:text,email:text,channels:z.array(channel).max(100).nullish()});
const user=z.object({id,name:text,email:text,phone:text,role:z.literal('end-user')});
function invalid():never{throw new ExternalProjectionError('source_invalid');}
function single(values:Array<string|null|undefined>){const unique=[...new Set(values.map(value=>value?.trim()??'').filter(Boolean))];return unique.length===1?unique[0]:'';}
function finish(contacts:z.infer<typeof nativeContactRow>[],next:string|null,current:string|null){
 if(new Set(contacts.map(row=>row.sourceId)).size!==contacts.length||next!==null&&(next===current||contacts.length===0))throw new ExternalProjectionError('source_changed');
 return {contacts,done:next===null,sourceCursor:next};
}
/** Account domain comes from the official account resource, not a guessed ID. */
export function checkGorgiasAccount(input:unknown,origin:string){
 const value=z.object({domain:z.string(),status:z.object({status:z.literal('active')})}).safeParse(input);
 if(!value.success||value.data.domain!==new URL(origin).hostname.slice(0,-'.gorgias.com'.length))throw new ExternalProjectionError('source_changed');
}
/** The cursor wrapper is required. The array-only OpenAPI shape cannot prove
 * the end of a paginated listing and is intentionally not treated as complete. */
export function projectGorgiasContacts(input:unknown,current:string|null){
 const parsed=z.object({object:z.literal('list'),data:z.array(customer).max(25),meta:z.object({next_cursor:externalOpaqueCursor.nullable()})}).safeParse(input);
 if(!parsed.success)invalid();
 const contacts=parsed.data.data.map(item=>nativeContactRow.parse({sourceId:String(item.id),name:item.name?.trim()??'',phone:single(item.channels?.filter(c=>c.type==='phone').map(c=>c.address)??[]),
   email:single([item.email,...item.channels?.filter(c=>c.type==='email').map(c=>c.address)??[]]),company:''}));
 return finish(contacts,parsed.data.meta.next_cursor,current);
}
/** Source verified/suspended flags and organization IDs do not grant transport
 * consent or identify a Riverz company. Only the explicit end-user rows pass. */
export function projectZendeskContacts(input:unknown,current:string|null){
 const parsed=z.object({users:z.array(user).max(25),meta:z.object({has_more:z.boolean(),after_cursor:externalOpaqueCursor.nullable()})}).safeParse(input);
 if(!parsed.success||parsed.data.meta.has_more&&parsed.data.meta.after_cursor===null)invalid();
 const contacts=parsed.data.users.map(item=>nativeContactRow.parse({sourceId:String(item.id),name:item.name?.trim()??'',phone:item.phone?.trim()??'',email:item.email?.trim()??'',company:''}));
 return finish(contacts,parsed.data.meta.has_more?parsed.data.meta.after_cursor:null,current);
}
