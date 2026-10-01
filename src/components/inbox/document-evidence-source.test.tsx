import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const m=vi.hoisted(()=>({locale:'es' as 'es'|'en'}));
vi.mock('@/hooks/use-locale',()=>({useT:()=>((key:string,args?:{n:string})=>key==='inbox.evidenceDocument'?(m.locale==='es'?'Documento':'Document'):(m.locale==='es'?'Versión ':'Version ')+args?.n)}));
vi.mock('@/hooks/use-format',()=>({useFormat:()=>({number:(n:number)=>String(n)})}));
import {DocumentEvidenceSource} from './document-evidence-source';
describe('Versioned document source in the existing evidence panel',()=>{
 it.each(['es','en'] as const)('shows %s metadata without a false message link or document content',locale=>{
  m.locale=locale;const markup=renderToStaticMarkup(<DocumentEvidenceSource source={{kind:'document',id:'11111111-1111-4111-8111-111111111111',title:'Policy <script>',revision:3}}/>);
  expect(markup).toContain('Policy &lt;script&gt;');expect(markup).toContain(locale==='es'?'Versión 3':'Version 3');expect(markup).not.toContain('href=');expect(markup).not.toContain('<script>');
 });
});
