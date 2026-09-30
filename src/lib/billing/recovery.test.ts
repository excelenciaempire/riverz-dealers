import {describe,expect,it,vi} from 'vitest';
import type {Conversation,Message} from '@/types';
vi.mock('@/lib/ai/runner',()=>({runAiAgent:vi.fn()}));
vi.mock('./external-replies',()=>({syncExternalReplies:vi.fn()}));
vi.mock('@/lib/comments/router',()=>({routeComment:vi.fn()}));
import {isReplyAfterInbound,recoveryDisposition} from './recovery';
describe('payment catch-up respects existing work',()=>{
 const active={ai_enabled:true,assigned_agent_id:null,status:'open',deleted_at:null} as unknown as Conversation;
 it('keeps human ownership, closed chats and intentionally disabled AI',()=>{
  expect(recoveryDisposition(active)).toBeNull();
  expect(recoveryDisposition({...active,ai_enabled:false})).toBe('ai_disabled');
  expect(recoveryDisposition({...active,assigned_agent_id:'human'})).toBe('assigned_to_human');
  expect(recoveryDisposition({...active,status:'closed'})).toBe('conversation_closed');
  expect(recoveryDisposition({...active,deleted_at:'2026-10-01'})).toBe('conversation_deleted');
 });
 it('native agent replies and sent bot replies cover an inbound; failed and earlier sends do not',()=>{
  const inbound={created_at:'2026-10-01T01:00:00Z'} as Message;
  const reply={sender_type:'agent',status:'sent',created_at:'2026-10-01T01:01:00Z'} as Message;
  expect(isReplyAfterInbound(reply,inbound)).toBe(true);
  expect(isReplyAfterInbound({...reply,sender_type:'bot'},inbound)).toBe(true);
  expect(isReplyAfterInbound({...reply,status:'failed'},inbound)).toBe(false);
  expect(isReplyAfterInbound({...reply,status:'sending'},inbound)).toBe(false);
  expect(isReplyAfterInbound({...reply,created_at:'2026-10-01T00:00:00Z'},inbound)).toBe(false);
 });
});
