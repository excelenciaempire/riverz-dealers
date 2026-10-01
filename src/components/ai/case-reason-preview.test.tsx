import {beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const m=vi.hoisted(()=>({shown:false,locale:'es' as 'es'|'en'}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown;}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=>((key:string)=>{const entry=operation[key.replace('operation.','') as keyof typeof operation];return entry?.[m.locale]??key;})}));
import {operation} from '@/lib/i18n/messages/operation';
import {ToolSwitchboard} from './tool-switchboard';
beforeEach(()=>{m.shown=false;m.locale='es';});
const render=()=>renderToStaticMarkup(<ToolSwitchboard agent={{}} tools={null} onChange={()=>{}} disponible={{tienda:false,shopify:false,cobro:false,descuento:false,voz:false}}/>);
describe('Classification is only visible in the final comparison build',()=>{
 it.each(['es','en'] as const)('preserves the current %s controls and hides the new setting',locale=>{
  m.locale=locale;const markup=render();expect(markup).not.toContain(operation.toolClasificarMotivo[locale]);expect(markup).toContain(operation.toolCerrarConversacion[locale]);
  m.shown=true;expect(render()).toContain(operation.toolClasificarMotivo[locale]);
 });
});
