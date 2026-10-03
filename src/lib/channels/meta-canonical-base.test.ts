import {afterEach,expect,it,vi} from 'vitest';
import {appSubscriptionGaps,appWebhookBaseUrl,APP_WEBHOOK_EXPECTATIONS} from './meta-graph';
afterEach(()=>vi.unstubAllEnvs());
it('keeps the product origin when no shared destination is configured',()=>{
 vi.stubEnv('META_WEBHOOK_BASE_URL','');vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://riverz-dealers.onrender.com');
 expect(appWebhookBaseUrl()).toBe('https://riverz-dealers.onrender.com');
});
it('uses the shared Meta destination without changing the product origin',()=>{
 vi.stubEnv('META_WEBHOOK_BASE_URL','https://riverz.co/');vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://riverz-dealers.onrender.com');
 expect(appWebhookBaseUrl()).toBe('https://riverz.co');expect(process.env.NEXT_PUBLIC_SITE_URL).toBe('https://riverz-dealers.onrender.com');
 const subs=Object.fromEntries(Object.entries(APP_WEBHOOK_EXPECTATIONS).map(([object,fields])=>[object,{active:true,fields,callbackUrl:'https://riverz.co/api/channels/whatsapp/webhook'}]));
 expect(appSubscriptionGaps(subs)).toEqual([]);
});
it.each(['http://localhost:3000','https://name:secret@riverz.co','https://riverz.co/path','https://riverz.co?token=secret'])('rejects an invalid shared destination %s',value=>{
 vi.stubEnv('META_WEBHOOK_BASE_URL',value);expect(()=>appWebhookBaseUrl()).toThrow();
});
