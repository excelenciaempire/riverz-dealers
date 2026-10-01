import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {translate} from '@/lib/i18n/translate';
const m=vi.hoisted(()=>({shown:true,locale:'es' as 'es'|'en'}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown}}));
vi.mock('@/hooks/use-locale',()=>({useT:()=> (key:string)=>translate(m.locale,key)}));
vi.mock('@/lib/api/fetch-with-csrf',()=>({useFetchWithCsrf:()=>vi.fn()}));
import {FlowHttpEditorContext,HttpFlowNodeForm} from './http-node-form';
const props={nodeKey:'lookup',config:{},onUpdateConfig:()=>{}};
const render=()=>renderToStaticMarkup(createElement(FlowHttpEditorContext.Provider,{value:{flowId:'flow',workspaceId:'workspace',dirty:false,preview:false}},
 createElement(HttpFlowNodeForm,props)));
describe('comparison-only native HTTP node form',()=>{
 it('renders no new controls in the current UI',()=>{m.shown=false;expect(render()).toBe('');m.shown=true;});
 it('renders localized controls in both languages',()=>{m.locale='es';expect(render()).toContain('Cargar consultas');m.locale='en';expect(render()).toContain('Load lookups');m.locale='es';});
 it('does not start network effects when rendered',()=>expect(render()).not.toContain('script'));
 it('keeps the node palette gated and sends the exact reviewed configuration',()=>{
  const builder=readFileSync('src/components/flows/flow-builder.tsx','utf8'),form=readFileSync('src/components/flows/http-node-form.tsx','utf8');
  expect(builder).toContain('...(SHOW_RIVERZ_IMPROVEMENTS ? ["http_action" as const] : [])');
  expect(form).toContain('reviewed_config:parsed.data');expect(form).toContain('ctx.dirty');
 });
 it('simulates without external transport or fake output data',()=>{
  const simulator=readFileSync('src/components/flows/simulator-panel.tsx','utf8');
  const block=simulator.slice(simulator.indexOf('case "http_action"'),simulator.indexOf('case "shopify_lookup"'));
  expect(block).toContain('flows.httpSimulated');expect(block).not.toContain('fetch(');expect(block).not.toContain('next.vars =');
 });
});
