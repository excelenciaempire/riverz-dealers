import 'server-only';
import {requestChatwootJson,PublicJsonError} from '@/lib/security/public-json-request';
import {nativeSourceDefinition,nativeSourceStart,type NativeSourceDefinition} from '../native-source-contract';
import {projectChatwootContacts,ChatwootMigrationError} from './chatwoot';
export class NativeSourceError extends Error{
  constructor(readonly code:'source_invalid'|'source_changed'|'source_limit'|'source_order_unsupported'|'source_auth'|'source_rate_limit'|'source_timeout'|'source_unavailable'){super(code);}
}
export async function readChatwootContactPage(source:NativeSourceDefinition,token:string,cursor:{page:number;total?:number}){
  const parsed=nativeSourceDefinition.safeParse(source);
  if(!parsed.success||!nativeSourceStart.shape.token.safeParse(token).success||!Number.isInteger(cursor.page)||cursor.page<1||cursor.page>334||
    cursor.total!==undefined&&(!Number.isInteger(cursor.total)||cursor.total<0||cursor.total>5000)||Object.keys(cursor).some(key=>!['page','total'].includes(key)))throw new NativeSourceError('source_invalid');
  const definition=parsed.data;
  const url=new URL(`/api/v1/accounts/${definition.accountId}/contacts`,definition.origin);
  url.searchParams.set('page',String(cursor.page));url.searchParams.set('sort','name');url.searchParams.set('include_contact_inboxes','false');
  try{
    const result=await requestChatwootJson({url:url.href,token});
    return projectChatwootContacts(result.data,{accountId:definition.accountId,page:cursor.page,...(cursor.total!==undefined?{total:cursor.total}:{})});
  }catch(error){
    if(error instanceof ChatwootMigrationError)throw new NativeSourceError(error.code);
    if(error instanceof PublicJsonError){
      if(error.status===401||error.status===403)throw new NativeSourceError('source_auth');
      if(error.status===429)throw new NativeSourceError('source_rate_limit');
      if(error.code==='http_timeout')throw new NativeSourceError('source_timeout');
      if(error.code==='http_response_too_large')throw new NativeSourceError('source_limit');
    }
    throw new NativeSourceError('source_unavailable');
  }
}
