import 'server-only';
import {z} from 'zod';
import {requestChatwootJson,PublicJsonError} from '@/lib/security/public-json-request';
import {nativeSourceDefinition,nativeSourceStart,type NativeSourceDefinition} from '../native-source-contract';
import {ChatwootMigrationError} from './chatwoot';
import {NativeSourceError} from './chatwoot-client';
import {projectChatwootContactConversations,projectChatwootHistoryMessages} from './chatwoot-history';
const id=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
function sourceContext(source:NativeSourceDefinition,token:string){
  const parsed=nativeSourceDefinition.safeParse(source);if(!parsed.success||!nativeSourceStart.shape.token.safeParse(token).success)throw new NativeSourceError('source_invalid');return parsed.data;
}
async function project<T>(url:URL,token:string,projection:(value:unknown)=>T):Promise<T>{
  try{return projection((await requestChatwootJson({url:url.href,token})).data);}
  catch(error){
    if(error instanceof ChatwootMigrationError)throw new NativeSourceError(error.code);
    if(error instanceof PublicJsonError){
      if(error.status===401||error.status===403)throw new NativeSourceError('source_auth');if(error.status===429)throw new NativeSourceError('source_rate_limit');
      if(error.code==='http_timeout')throw new NativeSourceError('source_timeout');if(error.code==='http_response_too_large')throw new NativeSourceError('source_limit');
      if(error.status===404)throw new NativeSourceError('source_changed');
    }
    throw new NativeSourceError('source_unavailable');
  }
}
/** Caller must obtain a fresh private lease/authority check before each read. */
export async function readChatwootContactConversations(source:NativeSourceDefinition,token:string,cursor:{contactId:number;anchorId?:number}){
  const definition=sourceContext(source,token),parsed=z.object({contactId:id,anchorId:id.optional()}).strict().safeParse(cursor);if(!parsed.success)throw new NativeSourceError('source_invalid');
  const value=parsed.data,url=new URL(`/api/v1/accounts/${definition.accountId}/contacts/${value.contactId}/conversations`,definition.origin);
  if(value.anchorId!==undefined)url.searchParams.set('conversation_id',String(value.anchorId));
  return project(url,token,data=>projectChatwootContactConversations(data,{accountId:definition.accountId,...value}));
}
export async function readChatwootHistoryMessages(source:NativeSourceDefinition,token:string,cursor:{conversationId:number;inboxId:number;before?:number}){
  const definition=sourceContext(source,token),parsed=z.object({conversationId:id,inboxId:id,before:z.number().int().min(1).max(2147483647).optional()}).strict().safeParse(cursor);if(!parsed.success)throw new NativeSourceError('source_invalid');
  const value=parsed.data,url=new URL(`/api/v1/accounts/${definition.accountId}/conversations/${value.conversationId}/messages`,definition.origin);
  if(value.before!==undefined)url.searchParams.set('before',String(value.before));
  return project(url,token,data=>projectChatwootHistoryMessages(data,{accountId:definition.accountId,...value}));
}
