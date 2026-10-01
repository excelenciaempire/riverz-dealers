import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {translate} from '@/lib/i18n/translate';
const h=vi.hoisted(()=>({visible:true,locale:'es' as 'es'|'en',request:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return h.visible;}}));
vi.mock('@/hooks/use-locale',()=>({useLocale:()=>({locale:h.locale}),useT:()=>(key:string)=>translate(h.locale,key)}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>h.request}));
import {HttpActionRunHistory} from './http-action-run-history';
beforeEach(()=>{h.visible=true;h.locale='es';vi.clearAllMocks();});
describe('Optional nested receipt history',()=>{
 it('does not render or fetch outside comparison or without access',()=>{
  h.visible=false;expect(renderToStaticMarkup(<HttpActionRunHistory workspaceId="ws" actionId="id" allowed/>)).toBe('');
  h.visible=true;expect(renderToStaticMarkup(<HttpActionRunHistory workspaceId="ws" actionId="id" allowed={false}/>)).toBe('');expect(h.request).not.toHaveBeenCalled();
 });
 it.each(['es','en'] as const)('starts collapsed and makes no receipt request (%s)',locale=>{
  h.locale=locale;const html=renderToStaticMarkup(<HttpActionRunHistory workspaceId="ws" actionId="id" allowed/>);
  expect(html).toContain('aria-expanded="false"');expect(html).toContain(translate(locale,'settings.httpRunsTitle'));expect(html).not.toContain('<table');expect(h.request).not.toHaveBeenCalled();
 });
});
