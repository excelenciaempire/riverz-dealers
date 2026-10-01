import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const h=vi.hoisted(()=>({visible:true,locale:'es' as 'es'|'en',sections:null as string[]|null,loading:false,request:vi.fn(),workspace:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.visible;}}));
vi.mock('@/hooks/use-locale',()=>({useLocale:()=>({locale:h.locale}),useT:()=>(key:string)=>translate(h.locale,key)}));
vi.mock('@/hooks/use-workspace',()=>({useWorkspace:h.workspace}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.request}));
import {PushNotifications} from './push-notifications';
beforeEach(()=>{vi.clearAllMocks();h.visible=true;h.locale='es';h.sections=null;h.loading=false;h.workspace.mockImplementation(()=>({loading:h.loading,workspace:{id:'ws',owner_id:'owner'},membership:{user_id:'agent',allowed_sections:h.sections}}));});
it('shows nothing and requests nothing outside comparison, during scope load or without Inbox access',()=>{
 h.visible=false;expect(renderToStaticMarkup(<PushNotifications/>)).toBe('');expect(h.workspace).not.toHaveBeenCalled();h.visible=true;h.loading=true;expect(renderToStaticMarkup(<PushNotifications/>)).toBe('');h.loading=false;h.sections=['/contactos'];expect(renderToStaticMarkup(<PushNotifications/>)).toBe('');expect(h.request).not.toHaveBeenCalled();
});
it.each(['es','en'] as const)('starts collapsed without permission prompts, service worker registration or backend requests (%s)',locale=>{
 h.locale=locale;const html=renderToStaticMarkup(<PushNotifications/>);expect(html).toContain('aria-expanded="false"');expect(html).toContain(translate(locale,'settings.pushTitle'));expect(html).not.toContain(translate(locale,'settings.pushStatus_enabled'));expect(h.request).not.toHaveBeenCalled();
});
