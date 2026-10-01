import {describe,expect,it,vi} from 'vitest';
import {loadDocumentContext} from './document-sources';
import {observeContext,observeDocumentSources,withTurnEvidence} from './turn-evidence';
import type {SourceObservation} from './turn-evidence-contract';
const agent='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const row={id,name:'Returns policy.docx',format:'docx',bytes:200,sha256:'a'.repeat(64),text:'Return requests are accepted within 14 days.',status:'active',revision:3,updated_at:'2026-10-01T00:00:00Z'};
describe('Document context is bound to an observed version',()=>{
 it('records only metadata for documents included in the context and survives later main-context preparation',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:[row],error:null});
  await withTurnEvidence(async()=>{
   expect(await loadDocumentContext({rpc} as never,ws,agent)).toContain(row.text);observeContext(agent,[],[{kind:'message',id:ws}]);
  },async state=>{
   expect(state.agentId).toBe(agent);expect(state.evidence.sources).toEqual([{kind:'document',id,revision:3,title:row.name},{kind:'message',id:ws}]);
   expect(JSON.stringify(state.evidence)).not.toContain(row.text);expect(state.evidence.tools).toEqual([]);
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('active_ai_document_sources',{p_workspace_id:ws,p_agent_id:agent});
 });
 it('does not record a withdrawn, malformed or failed document as a prepared source',async()=>{
  for(const result of [{data:[{...row,status:'withdrawn'}],error:null},{data:[row],error:{message:'private'}},{data:[],error:null}]){
   const save=vi.fn();await withTurnEvidence(async()=>{expect(await loadDocumentContext({rpc:async()=>result} as never,ws,agent)).toBe('');},save);expect(save).not.toHaveBeenCalled();
  }
 });
 it('records only excerpts that actually fit inside the voice budget',async()=>{
  await withTurnEvidence(async()=>{
   const text=await loadDocumentContext({rpc:async()=>({data:[{...row,text:'a'.repeat(5000)},{...row,id:ws,text:'b'.repeat(5000)}]})} as never,ws,agent,1000);
   expect(text.length).toBeLessThanOrEqual(1000);expect(text).toContain('Partial documentary context');
  },async state=>{expect(state.evidence.sources).toEqual([{kind:'document',id,revision:3,title:row.name}]);expect(state.evidence.truncated).toBe(true);});
 });
 it('does not record a document if even a data boundary cannot fit',async()=>{
  const save=vi.fn();await withTurnEvidence(async()=>{expect(await loadDocumentContext({rpc:async()=>({data:[row]})} as never,ws,agent,1)).toBe('');},save);expect(save).not.toHaveBeenCalled();
 });
 it('preserves distinct prepared revisions and rejects malformed version metadata',async()=>{
  await withTurnEvidence(async()=>{
   observeDocumentSources(agent,[{kind:'document',id,revision:3},{kind:'document',id,revision:4},{kind:'document',id,revision:3}]);
   observeDocumentSources(agent,[{kind:'document',id,revision:0},{kind:'document',id,revision:2147483648},{kind:'document',id:'invalid',revision:1}] as SourceObservation[]);
   observeContext(agent,[],[]);
  },async state=>{expect(state.evidence.sources).toEqual([{kind:'document',id,revision:3},{kind:'document',id,revision:4}]);});
 });
 it('refuses to mix another assistant into the current turn',async()=>{
  await withTurnEvidence(async()=>{
   observeContext(agent,[],[{kind:'message',id:ws}]);observeDocumentSources(ws,[{kind:'document',id,revision:3}]);
  },async state=>{expect(state.evidence.sources).toEqual([{kind:'message',id:ws}]);expect(state.evidence.truncated).toBe(true);});
 });
});
