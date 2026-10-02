import 'server-only';
import {z} from 'zod';
import {withAppsecretProof} from '@/lib/channels/meta-graph';
import {countryOfPhone} from '@/lib/whatsapp/phone-utils';
import {whatsappCallingVersion,whatsappPhoneId,whatsappPeer} from './whatsapp-calling-contract';
import {WhatsAppVoiceError} from './whatsapp-connector';

const coordinates=z.object({phoneNumberId:whatsappPhoneId,apiVersion:whatsappCallingVersion,accessToken:z.string().min(1).max(8192).refine(value=>!/[\s\0]/.test(value))}).strict();
type Coordinates=z.infer<typeof coordinates>;
const settings=z.object({calling:z.object({status:z.enum(['ENABLED','DISABLED']),sip:z.object({status:z.enum(['ENABLED','DISABLED'])}).passthrough().optional()}).passthrough()}).passthrough();
const permission=z.object({messaging_product:z.literal('whatsapp'),permission:z.object({status:z.enum(['no_permission','temporary','permanent']),expiration_time:z.number().int().positive().optional()}).passthrough(),actions:z.array(z.object({action_name:z.string(),can_perform_action:z.boolean()}).passthrough()).max(20)}).passthrough();
const excludedBusinessCountries=new Set(['US','CA','EG','VN','NG']);

export function parseWhatsAppCallPermission(value:unknown,now=Date.now()):boolean{
 const parsed=permission.safeParse(value);if(!parsed.success)return false;
 const data=parsed.data,actions=data.actions.filter(action=>action.action_name==='start_call');
 if(actions.length!==1||actions[0].can_perform_action!==true||data.permission.status==='no_permission')return false;
 return data.permission.status==='permanent'||(data.permission.expiration_time!==undefined&&data.permission.expiration_time*1000>now);
}
export function parseWhatsAppCallingSettings(value:unknown){
 const parsed=settings.safeParse(value);if(!parsed.success)throw new WhatsAppVoiceError('unavailable');
 return {enabled:parsed.data.calling.status==='ENABLED',graphCompatible:parsed.data.calling.sip?.status!=='ENABLED'};
}
async function boundedJson(response:Response):Promise<unknown>{
 if(!response.ok||!response.body)throw new WhatsAppVoiceError('unavailable');
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536)throw new WhatsAppVoiceError('unavailable');chunks.push(next.value);}}
 catch{await reader.cancel().catch(()=>undefined);throw new WhatsAppVoiceError('unavailable');}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WhatsAppVoiceError('unavailable');}
}

/** GET only: never changes Meta settings or sends a permission request. No
 * response cache or cross-recipient permission reuse. Credentials stay in a
 * Bearer header; graph host, version, number and path are fixed/validated.
 */
export function createWhatsAppCallingMeta(read:typeof fetch=fetch){
 async function get(value:unknown,suffix:string,query:Record<string,string>={}){
  const parsed=coordinates.safeParse(value);if(!parsed.success)throw new WhatsAppVoiceError('invalid');const input=parsed.data;
  const url=new URL(`https://graph.facebook.com/v${input.apiVersion}/${input.phoneNumberId}${suffix}`);
  for(const [key,val] of Object.entries(query))url.searchParams.set(key,val);
  try{return await boundedJson(await read(withAppsecretProof(url.toString(),input.accessToken),{method:'GET',headers:{Authorization:`Bearer ${input.accessToken}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)}));}
  catch{throw new WhatsAppVoiceError('unavailable');}
 }
 return {
  async settings(input:Coordinates){return parseWhatsAppCallingSettings(await get(input,'/settings'));},
  async outboundAllowed(input:Coordinates,peer:string){
   if(!whatsappPeer.safeParse(peer).success)throw new WhatsAppVoiceError('invalid');
   // Settings do not document the business country. Read this exact phone
   // number's identity; never substitute customer country or timezone.
   const [configuration,identity]=await Promise.all([get(input,'/settings'),get(input,'',{fields:'id,display_phone_number'})]);
   const state=parseWhatsAppCallingSettings(configuration),number=z.object({id:whatsappPhoneId,display_phone_number:z.string().min(1).max(64)}).passthrough().safeParse(identity);
   if(!state.enabled||!state.graphCompatible||!number.success||number.data.id!==input.phoneNumberId)return false;
   const country=countryOfPhone(number.data.display_phone_number);if(!country||excludedBusinessCountries.has(country))return false;
   // The current start_call action is authoritative. A message opt-in,
   // send_call_permission_request or a historical grant is insufficient.
   return parseWhatsAppCallPermission(await get(input,'/call_permissions',{user_wa_id:peer}));
  },
 };
}
