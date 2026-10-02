import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {contacts} from '@/lib/i18n/messages/contacts';
const state=vi.hoisted(()=>({enabled:true,locale:'es' as 'es'|'en'}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return state.enabled;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=>((key:string)=>contacts[key.replace(/^contacts\./,'') as keyof typeof contacts]?.[state.locale]??key)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({number:(value:number)=>String(value)})}));
vi.mock('@/hooks/use-workspace',()=>({useWorkspace:()=>({workspace:null})}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>()=>{throw new Error('No network in static review');}}));
import {MigrationPreview} from './migration-preview';
beforeEach(()=>{state.enabled=true;state.locale='es';});
describe('Migration review remains private and does not import on file selection',()=>{
  it.each(['es','en'] as const)('renders nothing outside comparison in %s',locale=>{state.enabled=false;state.locale=locale;expect(renderToStaticMarkup(<MigrationPreview />)).toBe('');});
  it.each(['es','en'] as const)('names the local scope and source in %s without an import action',locale=>{
    state.locale=locale;const html=renderToStaticMarkup(<MigrationPreview />);
    expect(html).toContain(contacts.migrationTitle[locale]);expect(html).toContain(contacts.migrationScope[locale]);
    expect(html).toContain('type="file"');expect(html).not.toContain('contacts.migration');expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('https://');expect(html).not.toContain('source_id');
  });
});
