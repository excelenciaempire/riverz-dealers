import type {TFn} from '@/lib/i18n/translate';
const PURPOSES:Record<string,string>={
 respuesta:'settings.walletPurposeReply',reescritura:'settings.walletPurposeRewrite',
 cierre_sin_respuesta:'settings.walletPurposeClosure',escalada:'settings.walletPurposeEscalation',
 escalada_por_que:'settings.walletPurposeEscalationNote',
};
export function movementContext(detail:Record<string,unknown>|undefined,t:TFn):string|null{
 const purpose=typeof detail?.para==='string'?PURPOSES[detail.para]:undefined;
 const channel=typeof detail?.canal==='string'?({whatsapp:'WhatsApp',gmail:'Gmail',outlook:'Outlook/Hotmail',zoho:'Zoho',instagram:'Instagram',messenger:'Messenger',ig_comment:'Instagram',fb_comment:'Facebook'} as Record<string,string>)[detail.canal]:null;
 return [purpose?t(purpose):null,channel].filter(Boolean).join(' · ')||null;
}
export function movementTokens(detail:Record<string,unknown>|undefined):number|null{
 const usage=detail?.usage;
 if(!usage||typeof usage!=='object')return null;
 const u=usage as Record<string,unknown>;
 const values=['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].map(k=>u[k]??0);
 if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))return null;
 const total=(values as number[]).reduce((a,b)=>a+b,0);
 return total>0?total:null;
}
