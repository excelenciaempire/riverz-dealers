import {z} from 'zod';
export const smsPhone=z.string().regex(/^\+[1-9]\d{6,14}$/);
export const smsMessageId=z.string().uuid();
export const smsProviderStatus=z.enum(['queued','sending','sent','expired','sending_failed','delivery_unconfirmed','delivered','delivery_failed','read']);
const basic=new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const extended=new Set(Array.from('\f^{}\\[~]|€'));
function validUtf16(value:string){
 for(let index=0;index<value.length;index++){
  const unit=value.charCodeAt(index);
  if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return false;}
  else if(unit>=0xdc00&&unit<=0xdfff)return false;
 }
 return true;
}
/** Counts encoding units, not visible glyphs. No normalization changes the
 * approved text. Carrier prices/fees are separate from this segment count.
 */
export function smsEncoding(text:unknown):{encoding:'GSM-7'|'UTF-16';units:number;segments:number}|null{
 if(typeof text!=='string'||!text.trim()||text.length>6700||/[\u0000-\u0009\u000b\u000e-\u001f\u007f]/u.test(text)||!validUtf16(text))return null;
 let units=0,gsm=true;for(const char of text){if(basic.has(char))units++;else if(extended.has(char))units+=2;else{gsm=false;break;}}
 if(!gsm)units=text.length;const single=gsm?160:70,multi=gsm?153:67,segments=units<=single?1:Math.ceil(units/multi);
 return segments<=10?{encoding:gsm?'GSM-7':'UTF-16',units,segments}:null;
}
export const reviewedSms=z.object({from:smsPhone,to:smsPhone,text:z.string().refine(value=>smsEncoding(value)!==null),type:z.literal('SMS')}).strict();
export const smsCost=z.object({amount:z.string().regex(/^\d+(?:\.\d{1,12})?$/).max(48),currency:z.string().regex(/^[A-Z]{3}$/)}).strip();
export function smsWasDelivered(status:z.infer<typeof smsProviderStatus>){return status==='delivered'||status==='read';}
