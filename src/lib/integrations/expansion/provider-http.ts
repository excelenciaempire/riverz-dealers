import 'server-only';
export class ExpansionProviderError extends Error{
 constructor(readonly code:'invalid'|'notAllowed'|'unavailable'|'uncertain'){super(`expansion_provider_${code}`);this.name='ExpansionProviderError';}
}
export type ExpansionProvider='telnyx'|'judgeme'|'recharge';
const origins:Record<ExpansionProvider,string>={telnyx:'https://api.telnyx.com',judgeme:'https://api.judge.me',recharge:'https://api.rechargeapps.com'};
export function privateProviderSecret(value:unknown):string{
 if(typeof value!=='string'||value.length<8||value.length>4096||/[\s\u0000-\u001f\u007f]/u.test(value))throw new ExpansionProviderError('invalid');return value;
}
/** Fixed provider origin, no redirects, retries or secret query parameters.
 * Caller-owned durable authority is required immediately before mutations.
 * This transport does not itself grant business/recipient authorization.
 */
export function expansionHttp(provider:ExpansionProvider,read:typeof fetch=fetch){
 return async(path:string,options:{method?:'GET'|'POST'|'PUT';headers:Record<string,string>;query?:Record<string,string>;body?:unknown;authorize?:()=>Promise<boolean>;responseKind?:'json'|'ack';successStatus?:number}):Promise<unknown>=>{
  const method=options.method??'GET';
  if(!path.startsWith('/')||path.startsWith('//')||/[?#\\\s\u0000-\u001f\u007f]/u.test(path))throw new ExpansionProviderError('invalid');
  const url=new URL(path,origins[provider]);if(url.origin!==origins[provider])throw new ExpansionProviderError('invalid');
  for(const [name,value] of Object.entries(options.query??{})){
   if(/token|secret|password|authorization|api.?key/i.test(name)||name.length>64||value.length>2048)throw new ExpansionProviderError('invalid');url.searchParams.set(name,value);
  }
  if(url.href.length>4096||method==='GET'&&options.body!==undefined)throw new ExpansionProviderError('invalid');
  if(method!=='GET'&&(!options.authorize||!await options.authorize()))throw new ExpansionProviderError('notAllowed');
  try{
   const response=await read(url.href,{method,headers:{Accept:'application/json',...options.headers,...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(options.body)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!response.ok||(options.successStatus!==undefined&&response.status!==options.successStatus))throw new Error('provider_response');
   if(options.responseKind==='ack'){await response.body?.cancel().catch(()=>undefined);return {providerStatus:response.status};}
   if(!response.body)throw new Error('provider_response');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>512*1024)throw new Error('provider_body_limit');chunks.push(next.value);}}
   catch(error){await reader.cancel().catch(()=>undefined);throw error;}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw new ExpansionProviderError(method==='GET'?'unavailable':'uncertain');}
 };
}
