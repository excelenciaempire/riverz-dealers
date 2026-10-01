import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m=vi.hoisted(()=>({shown:true,rpc:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return m.shown;}}));
import { classifyCaseReason,type CaseReasonRuntime } from './case-reason-tool';
const id='11111111-1111-4111-8111-111111111111';
const runtime:CaseReasonRuntime={db:{rpc:m.rpc} as unknown as SupabaseClient,workspaceId:id,agentId:id,conversationId:id,contactId:id,messageId:id};
const input={reason:'delivery',quote:'Where is my order?'};
beforeEach(()=>{vi.clearAllMocks();m.shown=true;m.rpc.mockResolvedValue({data:{status:'recorded',reason:'delivery'},error:null});});
describe('Conversation-bound case classification',()=>{
  it('is hidden without comparison and has no database effects in simulation',async()=>{
    m.shown=false;expect(JSON.parse(await classifyCaseReason(runtime,input)).ok).toBe(false);m.shown=true;
    expect(JSON.parse(await classifyCaseReason(runtime,input,true))).toEqual({ok:true,simulado:true,reason:'delivery'});expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([{...input,workspace_id:id},{...input,actor_id:id},{...input,reason:'invented'},{...input,quote:'short'}])('rejects malformed classifications and client-selected identities',async value=>{
    expect(JSON.parse(await classifyCaseReason(runtime,value)).ok).toBe(false);expect(m.rpc).not.toHaveBeenCalled();
  });
  it('sends only the server-bound context and a strict category with source quote',async()=>{
    expect(JSON.parse(await classifyCaseReason(runtime,input))).toEqual({ok:true,status:'recorded',reason:'delivery'});
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('classify_conversation_reason',{p_workspace_id:id,p_agent_id:id,p_conversation_id:id,p_contact_id:id,p_message_id:id,p_reason:'delivery',p_quote:input.quote});
  });
  it('preserves a manual decision without claiming the proposed classification was applied',async()=>{
    m.rpc.mockResolvedValueOnce({data:{status:'preserved',reason:'payment'},error:null});expect(JSON.parse(await classifyCaseReason(runtime,input))).toEqual({ok:true,status:'preserved',reason:'payment'});
  });
  it('does not expose private failure details or use a direct update fallback',async()=>{
    m.rpc.mockResolvedValueOnce({data:null,error:{message:'private password SQL'}}).mockRejectedValueOnce(new Error('private credential'));
    expect(await classifyCaseReason(runtime,input)).not.toMatch(/password|credential|SQL/);expect(JSON.parse(await classifyCaseReason(runtime,input)).ok).toBe(false);
  });
});
