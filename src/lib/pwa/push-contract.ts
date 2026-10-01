import {z} from 'zod';
const encoded=z.string().regex(/^[A-Za-z0-9_-]+$/);
/** Fixed browser push providers. No caller headers, arbitrary webhook or internal destination. */
export function pushEndpoint(raw:string):URL|null {
 try {
  const url=new URL(raw);
  if(raw.length>2048||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.search)return null;
  const allowed=(url.hostname==='fcm.googleapis.com'&&/^\/fcm\/send\/[A-Za-z0-9_:-]+$/.test(url.pathname))
   ||(url.hostname==='updates.push.services.mozilla.com'&&/^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname))
   ||(url.hostname==='web.push.apple.com'&&/^\/[A-Za-z0-9_/-]+$/.test(url.pathname));
  return allowed?url:null;
 }catch{return null;}
}
export const browserPushSubscription=z.object({endpoint:z.string().refine(value=>pushEndpoint(value)!==null),expirationTime:z.number().int().nonnegative().nullable(),
 keys:z.object({p256dh:encoded.length(87).refine(value=>value.startsWith('B')),auth:encoded.length(22)}).strict()}).strict();
export const pushNotice=z.object({version:z.literal(1),kind:z.enum(['mention','reminder','snooze']),conversation_id:z.string().uuid(),locale:z.enum(['es','en'])}).strict();
export const pushSave=z.object({subscription:browserPushSubscription,locale:z.enum(['es','en'])}).strict();
export const pushRemove=z.object({endpoint:z.string().refine(value=>pushEndpoint(value)!==null)}).strict();
export type BrowserPushSubscription=z.infer<typeof browserPushSubscription>;
export type PushNotice=z.infer<typeof pushNotice>;
