import 'server-only';
import {z} from 'zod';
import {countryOfPhone} from '@/lib/whatsapp/phone-utils';
import {ExpansionProviderError,expansionHttp,privateProviderSecret} from './provider-http';
import {reviewedSms,smsCost,smsMessageId,smsPhone,smsProviderStatus} from './sms-contract';
const opaque=z.string().min(1).max(128).refine(value=>!/[\s\u0000-\u001f\u007f]/u.test(value));
import {smsProviderIdentity,type SmsProviderIdentity} from './sms-ui-contract';
export {smsProviderIdentity,type SmsProviderIdentity} from './sms-ui-contract';
const identity=smsProviderIdentity;
const capabilities=z.object({domestic_two_way:z.boolean(),international_inbound:z.boolean(),international_outbound:z.boolean()}).passthrough();
const numberSchema=z.object({data:z.object({id:opaque,phone_number:smsPhone,organization_id:opaque,messaging_profile_id:z.string().nullable(),country_code:z.string().regex(/^[A-Z]{2}$/),features:z.object({sms:capabilities.nullable()}).passthrough()}).passthrough()}).passthrough();
const profileSchema=z.object({data:z.object({id:z.string().uuid(),organization_id:opaque,enabled:z.boolean(),webhook_api_version:z.string(),whitelisted_destinations:z.array(z.string().regex(/^(?:[A-Z]{2}|\*)$/)).max(250),mobile_only:z.boolean(),daily_spend_limit_enabled:z.boolean()}).passthrough()}).passthrough();
const optout=z.object({from:smsPhone,to:smsPhone,messaging_profile_id:z.string(),keyword:z.string().min(1).max(64)}).passthrough();
const optoutsSchema=z.object({data:z.array(optout).max(250),meta:z.object({page_number:z.number().int().positive(),total_pages:z.number().int().nonnegative()}).passthrough()}).passthrough();
const messageSchema=z.object({data:z.object({id:smsMessageId,direction:z.literal('outbound'),type:z.literal('SMS'),organization_id:z.string().uuid(),messaging_profile_id:z.string(),from:z.object({phone_number:smsPhone}).passthrough(),to:z.array(z.object({phone_number:smsPhone,status:smsProviderStatus}).passthrough()).length(1),parts:z.number().int().min(1).max(10),cost:smsCost.nullable().optional(),errors:z.array(z.unknown()).max(100).optional()}).passthrough()}).passthrough();
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new ExpansionProviderError('unavailable');return result.data;}
function message(value:unknown,expected:SmsProviderIdentity,recipient:string,expectedId?:string){
 const row=parse(messageSchema,value).data;
 if(row.from.phone_number!==expected.phone||row.to[0].phone_number!==recipient||row.organization_id!==expected.organizationId||row.messaging_profile_id!==expected.profileId||(expectedId!==undefined&&row.id!==expectedId))throw new ExpansionProviderError('unavailable');
 return {id:row.id,status:row.to[0].status,parts:row.parts,cost:row.cost??null,hasProviderErrors:!!row.errors?.length};
}
/** Native text SMS only. This client is not an activation, a pricing quote,
 * a consent grant or a replacement for durable reviewed send authority.
 */
export function createTelnyxSmsClient(secret:string,read:typeof fetch=fetch){
 const key=privateProviderSecret(secret),request=expansionHttp('telnyx',read),headers={Authorization:`Bearer ${key}`};
 async function account(expected:SmsProviderIdentity){
   const input=parse(identity,expected);
   const [number,profile]=await Promise.all([
    request(`/v2/phone_numbers/${encodeURIComponent(input.phoneNumberId)}/messaging`,{headers}).then(value=>parse(numberSchema,value).data),
    request(`/v2/messaging_profiles/${input.profileId}`,{headers}).then(value=>parse(profileSchema,value).data),
   ]);
   if(number.id!==input.phoneNumberId||number.phone_number!==input.phone||number.organization_id!==input.organizationId||number.messaging_profile_id!==input.profileId||profile.id!==input.profileId||profile.organization_id!==input.organizationId)throw new ExpansionProviderError('notAllowed');
   return {input,number,profile};
  }
 async function available(expected:SmsProviderIdentity,recipient:string){
   if(!smsPhone.safeParse(recipient).success)throw new ExpansionProviderError('invalid');
   const destination=countryOfPhone(recipient);if(!destination)throw new ExpansionProviderError('notAllowed');
   const {input,number,profile}=await account(expected);
   if(!profile.enabled||profile.webhook_api_version!=='2'||!number.features.sms||profile.mobile_only||!profile.daily_spend_limit_enabled||!(profile.whitelisted_destinations.includes('*')||profile.whitelisted_destinations.includes(destination)))return false;
   if(!(destination===number.country_code?number.features.sms.domestic_two_way:number.features.sms.international_outbound))return false;
   // Complete the scoped opt-out scan. A budget/response failure is not a
   // negative opt-out result. No START/UNSTOP or registration writes occur.
   const optoutRows=new Set<string>();let totalPages:number|undefined;
   for(let page=1;page<=20;page++){
    const value=parse(optoutsSchema,await request('/v2/messaging_optouts',{headers,query:{'filter[messaging_profile_id]':input.profileId,'page[number]':String(page),'page[size]':'250'}}));
    if(value.meta.page_number!==page||value.meta.total_pages>20||(totalPages!==undefined&&value.meta.total_pages!==totalPages))throw new ExpansionProviderError('unavailable');totalPages=value.meta.total_pages;
    // STOP applies to the entire messaging profile, including a STOP sent
    // to another business number in this same profile.
    for(const row of value.data){const rowKey=`${row.from}:${row.to}`;if(row.messaging_profile_id!==input.profileId||optoutRows.has(rowKey))throw new ExpansionProviderError('unavailable');optoutRows.add(rowKey);if(row.to===recipient)return false;}
    if(page>=totalPages)return true;if(value.data.length===0)throw new ExpansionProviderError('unavailable');
   }
   throw new ExpansionProviderError('unavailable');
  }
 return {
  async verifyAccount(expected:SmsProviderIdentity){
   const {number,profile}=await account(expected);
   if(!profile.enabled||profile.webhook_api_version!=='2'||!number.features.sms||profile.mobile_only||!profile.daily_spend_limit_enabled)throw new ExpansionProviderError('notAllowed');
   return {country:number.country_code,capabilities:number.features.sms,providerSpendLimitEnabled:true as const};
  },
  available,
  async send(expected:SmsProviderIdentity,input:unknown,authorize:()=>Promise<boolean>){
   const target=parse(identity,expected),sms=parse(reviewedSms,input);if(sms.from!==target.phone)throw new ExpansionProviderError('notAllowed');
   // Account/capacity/consent checks must be performed by the caller; this
   // method repeats current provider ownership/opt-out before its one POST.
   if(!await available(target,sms.to))throw new ExpansionProviderError('notAllowed');
   let raw:unknown;try{raw=await request('/v2/messages',{method:'POST',headers,body:sms,authorize});return {accepted:true as const,...message(raw,target,sms.to)};}
   catch(error){if(error instanceof ExpansionProviderError&&error.code==='notAllowed')throw error;throw new ExpansionProviderError('uncertain');}
  },
  async receipt(expected:SmsProviderIdentity,recipient:string,id:string){
   const target=parse(identity,expected);if(!smsPhone.safeParse(recipient).success||!smsMessageId.safeParse(id).success)throw new ExpansionProviderError('invalid');
   // Provider lookup covers at most ten days. Local receipt history remains
   // separate; a 404 is unavailable, never proof that no send occurred.
   return message(await request(`/v2/messages/${id}`,{headers}),target,recipient,id);
  },
 };
}
