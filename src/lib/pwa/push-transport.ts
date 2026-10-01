import 'server-only';
import {request} from 'node:https';
import webpush from 'web-push';
import {publicMediaLookup} from '@/lib/security/download-public-media';
import {browserPushSubscription,pushEndpoint,pushNotice,type BrowserPushSubscription,type PushNotice} from './push-contract';
/** The library only encrypts/signs. Transport uses pinned public DNS, TLS, no redirects and a fixed deadline. */
export async function sendBrowserPush(subscription:BrowserPushSubscription,notice:PushNotice,keys:{publicKey:string;privateKey:string}) {
 const parsed=browserPushSubscription.parse(subscription),data=pushNotice.parse(notice),url=pushEndpoint(parsed.endpoint);
 if(!url)throw new Error('push_destination_forbidden');
 const details=webpush.generateRequestDetails(parsed,JSON.stringify(data),{TTL:600,urgency:'normal',contentEncoding:'aes128gcm',vapidDetails:{subject:'https://riverz.co',...keys}});
 if(details.endpoint!==url.href||details.method!=='POST'||!Buffer.isBuffer(details.body)||details.body.length>4096)throw new Error('push_transport_invalid');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try {
  const lookup=await Promise.race([publicMediaLookup(url),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('push_timeout')),{once:true}))]);
  controller.signal.throwIfAborted();
  return await new Promise<number>((resolve,reject)=>{
   const outgoing=request(url,{method:'POST',headers:details.headers,lookup,agent:false,rejectUnauthorized:true,maxHeaderSize:8192,signal:controller.signal},response=>{
    const status=response.statusCode;
    // Status is sufficient; do not collect provider response bodies or headers.
    response.on('error',()=>reject(new Error('push_transport_failed')));
    if(!status||status<100||status>599){response.destroy();reject(new Error('push_response_invalid'));return;}
    response.destroy();resolve(status);
   });
   outgoing.on('error',()=>reject(new Error('push_transport_failed')));outgoing.end(details.body);
  });
 }finally{clearTimeout(timer);controller.abort();}
}
