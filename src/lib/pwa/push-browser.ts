import {browserPushSubscription,type BrowserPushSubscription} from './push-contract';
export function browserPushSupported(host:Window) {
 return host.isSecureContext&&'serviceWorker' in host.navigator&&'PushManager' in host&&'Notification' in host;
}
function serverKey(value:string){
 if(!/^[A-Za-z0-9_-]{87}$/.test(value))throw new Error('push_unavailable');
 const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='),char=>char.charCodeAt(0));
 if(bytes.length!==65||bytes[0]!==4)throw new Error('push_unavailable');return bytes;
}
async function activeRegistration(host:Window){
 const existing=await host.navigator.serviceWorker.getRegistration('/');
 if(existing?.active&&existing.active.scriptURL!==new URL('/api/pwa/worker',host.location.origin).href)throw new Error('push_unavailable');
 const registration=await host.navigator.serviceWorker.register('/api/pwa/worker',{scope:'/',updateViaCache:'none'});
 if(!registration.active){
  const worker=registration.installing??registration.waiting;if(!worker)throw new Error('push_unavailable');
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(new Error('push_unavailable'));},10000);
   function changed(){if(worker!.state==='activated'||worker!.state==='redundant'){clearTimeout(timer);worker!.removeEventListener('statechange',changed);if(worker!.state==='activated')resolve();else reject(new Error('push_unavailable'));}}
   worker.addEventListener('statechange',changed);changed();
  });
 }
 if(registration.active?.scriptURL!==new URL('/api/pwa/worker',host.location.origin).href)throw new Error('push_unavailable');return registration;
}
/** Permission request starts synchronously in the user's click. No enrollment on mount. */
export async function enableBrowserPush(host:Window,key:string,save:(subscription:BrowserPushSubscription)=>Promise<void>){
 if(!browserPushSupported(host))throw new Error('push_unsupported');
 const applicationServerKey=serverKey(key);
 const permission=await (host as Window & typeof globalThis).Notification.requestPermission();if(permission!=='granted')throw new Error('push_denied');
 const registration=await activeRegistration(host),existing=await registration.pushManager.getSubscription();
 if(existing?.options.applicationServerKey&&(existing.options.applicationServerKey.byteLength!==applicationServerKey.length||!Array.from(new Uint8Array(existing.options.applicationServerKey)).every((byte,index)=>byte===applicationServerKey[index])))throw new Error('push_key_changed');
 const subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
 try{await save(browserPushSubscription.parse(subscription.toJSON()));}
 catch(error){if(!existing)await subscription.unsubscribe().catch(()=>false);throw error;}
}
export async function disableBrowserPush(host:Window,remove:(endpoint:string)=>Promise<void>){
 if(!browserPushSupported(host))throw new Error('push_unsupported');
 const registration=await host.navigator.serviceWorker.getRegistration('/');
 if(registration?.active?.scriptURL!==new URL('/api/pwa/worker',host.location.origin).href)return;
 const subscription=await registration.pushManager.getSubscription();if(!subscription)return;
 await remove(subscription.endpoint);if(!await subscription.unsubscribe())throw new Error('push_unavailable');
}
