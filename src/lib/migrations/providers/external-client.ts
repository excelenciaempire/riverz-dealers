import 'server-only';
import {requestExternalContactJson,PublicJsonError} from '@/lib/security/public-json-request';
import {externalSourceDefinition,externalToken,externalOpaqueCursor,type ExternalSourceDefinition} from '../external-source-contract';
import {checkGorgiasAccount,projectGorgiasContacts,projectZendeskContacts} from './cursor-contacts';
import {projectKommoContacts,projectManyChatContact,checkManyChatPage,ExternalProjectionError} from './external-contacts';
import {NativeSourceError} from './chatwoot-client';
export async function readExternalContactPage(source:ExternalSourceDefinition,token:string,cursor:{page:number;collected:number;lastId:number;sourceCursor?:string|null}){
 try{
  const definition=externalSourceDefinition.safeParse(source);
  if(!definition.success||!externalToken.safeParse(token).success||!Number.isInteger(cursor.page)||cursor.page<1||cursor.page>201||!Number.isInteger(cursor.collected)||cursor.collected<0||cursor.collected>5000||!Number.isSafeInteger(cursor.lastId)||cursor.lastId<0||Object.keys(cursor).some(key=>!['page','collected','lastId','sourceCursor'].includes(key)))throw new NativeSourceError('source_invalid');
  const value=definition.data;
  if(value.provider==='gorgias'||value.provider==='zendesk'){
   if(cursor.page===1?cursor.sourceCursor!==null&&cursor.sourceCursor!==undefined||cursor.collected!==0:!externalOpaqueCursor.safeParse(cursor.sourceCursor).success||cursor.collected<1||cursor.collected>(cursor.page-1)*25)throw new NativeSourceError('source_changed');
   const current=cursor.sourceCursor??null;
   if(value.provider==='gorgias'){
    const account=await requestExternalContactJson({provider:value.provider,url:value.origin+'/api/account',token});
    if(account.status!==200)throw new NativeSourceError('source_invalid');checkGorgiasAccount(account.data,value.origin);
   }
   const url=new URL(value.provider==='gorgias'?'/api/customers':'/api/v2/users.json',value.origin);
   if(value.provider==='gorgias'){url.searchParams.set('limit','25');url.searchParams.set('order_by','created_datetime:asc');if(current)url.searchParams.set('cursor',current);}
   else{url.searchParams.set('page[size]','25');url.searchParams.set('role','end-user');url.searchParams.set('include_boundary_indicators','true');if(current)url.searchParams.set('page[after]',current);}
   const result=await requestExternalContactJson({provider:value.provider,url:url.href,token});if(result.status!==200)throw new NativeSourceError('source_invalid');
   return value.provider==='gorgias'?projectGorgiasContacts(result.data,current):projectZendeskContacts(result.data,current);
  }
  if(cursor.sourceCursor!==undefined&&cursor.sourceCursor!==null)throw new NativeSourceError('source_changed');
  if(value.provider==='kommo'){
   if(cursor.collected!==(cursor.page-1)*25)throw new NativeSourceError('source_changed');
   const url=new URL('/api/v4/contacts',value.origin);url.searchParams.set('page',String(cursor.page));url.searchParams.set('limit','25');url.searchParams.set('order[id]','asc');
   const result=await requestExternalContactJson({provider:value.provider,url:url.href,token});
   if(result.status!==200&&result.status!==204||result.status===200&&result.data===null)throw new NativeSourceError('source_invalid');
   return projectKommoContacts(result.data,{source:value,page:cursor.page,lastId:cursor.lastId});
  }
  if(cursor.collected!==cursor.page-1||cursor.page>value.subscriberIds.length)throw new NativeSourceError('source_changed');
  // Recheck the token's owning Page for every selected contact, without probing
  // other accounts, following links or treating source opt-ins as consent.
  const page=await requestExternalContactJson({provider:value.provider,url:value.origin+'/fb/page/getInfo',token});if(page.status!==200)throw new NativeSourceError('source_invalid');checkManyChatPage(page.data,value.accountId);
  const url=new URL('/fb/subscriber/getInfo',value.origin);url.searchParams.set('subscriber_id',String(value.subscriberIds[cursor.collected]));
  const result=await requestExternalContactJson({provider:value.provider,url:url.href,token});
  if(result.status!==200)throw new NativeSourceError('source_invalid');
  return {contacts:[projectManyChatContact(result.data,{accountId:value.accountId,subscriberId:value.subscriberIds[cursor.collected]})],done:cursor.page===value.subscriberIds.length};
 }catch(error){
  if(error instanceof NativeSourceError)throw error;if(error instanceof ExternalProjectionError)throw new NativeSourceError(error.code);
  if(error instanceof PublicJsonError){if([401,402,403].includes(error.status??0))throw new NativeSourceError('source_auth');if(error.status===429)throw new NativeSourceError('source_rate_limit');if(error.code==='http_timeout')throw new NativeSourceError('source_timeout');if(error.code==='http_response_too_large')throw new NativeSourceError('source_limit');}
  throw new NativeSourceError('source_unavailable');
 }
}
