import {createECDH,randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({status:201,request:vi.fn(),lookup:vi.fn(),body:null as Buffer|null}));
vi.mock('node:https',()=>({request:h.request}));
vi.mock('@/lib/security/download-public-media',()=>({publicMediaLookup:h.lookup}));
import {sendBrowserPush} from './push-transport';
const pair=createECDH('prime256v1');pair.generateKeys();const keys={publicKey:pair.getPublicKey().toString('base64url'),privateKey:Buffer.concat([Buffer.alloc(32),pair.getPrivateKey()]).subarray(-32).toString('base64url')};
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',expirationTime:null,keys:{p256dh:keys.publicKey,auth:randomBytes(16).toString('base64url')}};
const notice={version:1 as const,kind:'mention' as const,conversation_id:'11111111-1111-4111-8111-111111111111',locale:'en' as const};
const pinned=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();h.status=201;h.body=null;h.lookup.mockResolvedValue(pinned);
 h.request.mockImplementation((_url:URL,_options:unknown,callback:(response:unknown)=>void)=>{
  const outgoing=new EventEmitter() as EventEmitter&{end:(body:Buffer)=>void};outgoing.end=body=>{h.body=body;const response=new EventEmitter() as EventEmitter&{statusCode:number;destroy:()=>void};response.statusCode=h.status;response.destroy=vi.fn();callback(response);};return outgoing;
 });
});
describe('Synthetic encrypted Web Push with bounded pinned transport',()=>{
 it('encrypts and signs locally, pinning the checked DNS set without a real provider request',async()=>{
  expect(await sendBrowserPush(subscription,notice,keys)).toBe(201);expect(h.lookup).toHaveBeenCalledExactlyOnceWith(new URL(subscription.endpoint));
  const [url,options]=h.request.mock.calls[0];expect(url.href).toBe(subscription.endpoint);expect(options).toMatchObject({method:'POST',lookup:pinned,agent:false,rejectUnauthorized:true,maxHeaderSize:8192});
  expect(options.headers).toMatchObject({'Content-Encoding':'aes128gcm',TTL:600});expect(options.headers.Authorization).toMatch(/^vapid /);
  expect(h.body).toBeInstanceOf(Buffer);expect(h.body!.length).toBeLessThan(4096);expect(h.body!.toString('utf8')).not.toContain(notice.conversation_id);expect(h.request).toHaveBeenCalledOnce();
 });
 it('does not follow redirects or read private provider bodies',async()=>{h.status=302;expect(await sendBrowserPush(subscription,notice,keys)).toBe(302);expect(h.request).toHaveBeenCalledOnce();});
 it('rejects a DNS destination containing a private address before opening a socket',async()=>{h.lookup.mockRejectedValue(new Error('private_address'));await expect(sendBrowserPush(subscription,notice,keys)).rejects.toThrow();expect(h.request).not.toHaveBeenCalled();});
 it('rejects any arbitrary destination before DNS or a socket',async()=>{await expect(sendBrowserPush({...subscription,endpoint:'https://127.0.0.1/push'},notice,keys)).rejects.toThrow();expect(h.lookup).not.toHaveBeenCalled();expect(h.request).not.toHaveBeenCalled();});
});
