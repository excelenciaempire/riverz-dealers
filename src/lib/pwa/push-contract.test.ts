import {describe,expect,it,vi} from 'vitest';
import {runInNewContext} from 'node:vm';
import {pushEndpoint,pushNotice} from './push-contract';
import {notificationWorker} from './notification-worker';
const id='11111111-1111-4111-8111-111111111111',notice={version:1,kind:'mention',conversation_id:id,locale:'en'};
describe('Provider destinations and neutral notice worker',()=>{
 it.each(['https://fcm.googleapis.com/fcm/send/token','https://updates.push.services.mozilla.com/wpush/v2/token','https://web.push.apple.com/token'])('supports fixed push provider %s',url=>{expect(pushEndpoint(url)?.href).toBe(url);});
 it.each(['http://fcm.googleapis.com/fcm/send/token','https://fcm.googleapis.com.evil.test/fcm/send/token','https://127.0.0.1/push','https://fcm.googleapis.com:444/fcm/send/token','https://user@fcm.googleapis.com/fcm/send/token','https://fcm.googleapis.com/fcm/send/token?private=1','https://riverz.co/push'])('rejects %s',url=>{expect(pushEndpoint(url)).toBeNull();});
 it('rejects any custom customer body, URL, billing decision or actor in the payload',()=>{
  expect(pushNotice.safeParse(notice).success).toBe(true);for(const extra of [{body:'PRIVATE CUSTOMER'},{url:'https://evil.test'},{actor:id},{approved:true}])expect(pushNotice.safeParse({...notice,...extra}).success).toBe(false);
 });
 it('registers no fetch cache and shows neutral text without customer content',async()=>{
  const listeners=new Map<string,(event:unknown)=>void>(),show=vi.fn().mockResolvedValue(undefined),open=vi.fn().mockResolvedValue(undefined),wait=vi.fn();
  runInNewContext(notificationWorker,{URL,self:{addEventListener:(name:string,handler:(event:unknown)=>void)=>listeners.set(name,handler),registration:{showNotification:show},clients:{openWindow:open},location:{origin:'https://riverz.test'}}});
  expect([...listeners.keys()]).toEqual(['push','notificationclick']);listeners.get('push')!({data:{json:()=>notice},waitUntil:wait});expect(show).toHaveBeenCalledWith('Riverz',expect.objectContaining({body:'You have a team notice. Sign in to Riverz to review it.'}));
  listeners.get('push')!({data:{json:()=>({...notice,body:'PRIVATE CUSTOMER'})},waitUntil:wait});expect(show).toHaveBeenCalledOnce();
  listeners.get('notificationclick')!({notification:{close:vi.fn(),data:{conversation_id:id,locale:'en',url:'https://evil.test'}},waitUntil:wait});expect(open).toHaveBeenCalledWith('https://riverz.test/inbox?c='+id);
 });
});
