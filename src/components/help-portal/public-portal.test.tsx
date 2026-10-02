import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {PortalArticles} from './public-portal';
import type {PublicPortal} from '@/lib/help-portal/contract';
const portal:PublicPortal={slug:'fixture-shop',brand:{name:'Fixture',description:'Help',accent:'#123456'},locale:'en',articles:[{id:'11111111-1111-4111-8111-111111111111',title:'<script>private</script>',body:'<img src="https://untrusted.test" onerror="alert(1)">',revision:2,updated_at:'2026-10-02T00:00:00Z'}]};
describe('Safe branded public articles',()=>{
 it.each(['es','en'] as const)('escapes source HTML and renders localized self-report controls in %s without provider/model calls',locale=>{
  const network=vi.spyOn(globalThis,'fetch');const html=renderToStaticMarkup(<PortalArticles portal={{...portal,locale}}/>);
  expect(html).not.toContain('<script>');expect(html).not.toContain('<img ');expect(html).toContain('&lt;img');
  expect(html).toContain(locale==='es'?'Resolvió mi consulta':'This answered my question');expect(html).not.toContain('tickets avoided');expect(network).not.toHaveBeenCalled();network.mockRestore();
 });
});
