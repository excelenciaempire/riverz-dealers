import {createECDH,randomBytes} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {browserPushSupported,enableBrowserPush,disableBrowserPush} from './push-browser';
const pair=createECDH('prime256v1');pair.generateKeys();const key=pair.getPublicKey().toString('base64url');
const data={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',expirationTime:null,keys:{p256dh:key,auth:randomBytes(16).toString('base64url')}};
let subscription:{endpoint:string;options:{applicationServerKey:ArrayBuffer};toJSON:()=>typeof data;unsubscribe:ReturnType<typeof vi.fn>};
let registration:{active:{scriptURL:string};pushManager:{getSubscription:ReturnType<typeof vi.fn>;subscribe:ReturnType<typeof vi.fn>}};
let permission:ReturnType<typeof vi.fn>,register:ReturnType<typeof vi.fn>,getRegistration:ReturnType<typeof vi.fn>,host:Window;
beforeEach(()=>{
 subscription={endpoint:data.endpoint,options:{applicationServerKey:Uint8Array.from(Buffer.from(key,'base64url')).buffer},toJSON:()=>data,unsubscribe:vi.fn().mockResolvedValue(true)};
 registration={active:{scriptURL:'https://riverz.test/api/pwa/worker'},pushManager:{getSubscription:vi.fn().mockResolvedValue(null),subscribe:vi.fn().mockResolvedValue(subscription)}};
 permission=vi.fn().mockResolvedValue('granted');register=vi.fn().mockResolvedValue(registration);getRegistration=vi.fn().mockResolvedValue(registration);
 host={isSecureContext:true,location:{origin:'https://riverz.test'},PushManager:{},Notification:{requestPermission:permission},navigator:{serviceWorker:{register,getRegistration}}} as unknown as Window;
});
describe('Voluntary device enrollment',()=>{
 it('requests permission immediately from the click and enrolls with userVisibleOnly',async()=>{
  const save=vi.fn().mockResolvedValue(undefined),pending=enableBrowserPush(host,key,save);expect(permission).toHaveBeenCalledOnce();await pending;
  expect(register).toHaveBeenCalledWith('/api/pwa/worker',{scope:'/',updateViaCache:'none'});expect(registration.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({userVisibleOnly:true}));expect(save).toHaveBeenCalledWith(data);
 });
 it('does not register or write when the browser denies permission',async()=>{
  permission.mockResolvedValue('denied');const save=vi.fn();await expect(enableBrowserPush(host,key,save)).rejects.toThrow('push_denied');expect(register).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 });
 it('refuses insecure or unsupported contexts before a permission prompt',async()=>{
  Object.assign(host,{isSecureContext:false});expect(browserPushSupported(host)).toBe(false);await expect(enableBrowserPush(host,key,vi.fn())).rejects.toThrow('push_unsupported');expect(permission).not.toHaveBeenCalled();
 });
 it('rolls back only a newly created subscription if private registration fails',async()=>{
  const save=vi.fn().mockRejectedValue(new Error('forbidden'));await expect(enableBrowserPush(host,key,save)).rejects.toThrow('forbidden');expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  subscription.unsubscribe.mockClear();registration.pushManager.getSubscription.mockResolvedValue(subscription);await expect(enableBrowserPush(host,key,save)).rejects.toThrow('forbidden');expect(subscription.unsubscribe).not.toHaveBeenCalled();
 });
 it('does not silently replace an existing subscription for different server keys',async()=>{
  subscription.options.applicationServerKey=new Uint8Array(65).buffer;registration.pushManager.getSubscription.mockResolvedValue(subscription);
  const save=vi.fn();await expect(enableBrowserPush(host,key,save)).rejects.toThrow('push_key_changed');expect(subscription.unsubscribe).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 });
 it('removes the server credential before browser unsubscribe and preserves it on server denial',async()=>{
  registration.pushManager.getSubscription.mockResolvedValue(subscription);const remove=vi.fn().mockRejectedValue(new Error('forbidden'));
  await expect(disableBrowserPush(host,remove)).rejects.toThrow('forbidden');expect(subscription.unsubscribe).not.toHaveBeenCalled();remove.mockResolvedValue(undefined);await disableBrowserPush(host,remove);
  expect(remove).toHaveBeenCalledWith(data.endpoint);expect(subscription.unsubscribe).toHaveBeenCalledOnce();
 });
 it('does not adopt or unsubscribe a service worker owned by another feature',async()=>{
  registration.active.scriptURL='https://riverz.test/other-worker.js';const save=vi.fn();await expect(enableBrowserPush(host,key,save)).rejects.toThrow('push_unavailable');await disableBrowserPush(host,save);expect(register).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(subscription.unsubscribe).not.toHaveBeenCalled();
 });
});
