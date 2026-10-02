import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readVoiceMailboxAudio,isVoiceMailboxCall} from './mailbox-audio';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const rpc=vi.fn(),sign=vi.fn(),bucket=vi.fn(()=>({createSignedUrl:sign}));
const db={rpc,storage:{from:bucket}} as never,call={id,workspace_id:ws};
beforeEach(()=>{vi.clearAllMocks();rpc.mockResolvedValue({data:true,error:null});sign.mockResolvedValue({data:{signedUrl:'https://example.invalid/private-audio'},error:null});});
describe('private mailbox playback',()=>{
 it('signs only the exact private object after current access',async()=>{
  expect(await readVoiceMailboxAudio(db,call,actor,ws)).toBe('https://example.invalid/private-audio');
  expect(rpc).toHaveBeenCalledWith('voice_human_access',{p_workspace_id:ws,p_actor_id:actor,p_call_id:id});
  expect(bucket).toHaveBeenCalledWith('voice-recordings');expect(sign).toHaveBeenCalledWith(id+'.ogg',60);
 });
 it.each([null,'44444444-4444-4444-8444-444444444444'])('blocks another selected workspace before signing',async selected=>{
  await expect(readVoiceMailboxAudio(db,call,actor,selected)).rejects.toMatchObject({code:'notFound'});expect(rpc).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
 });
 it('blocks revoked role, section, conversation or personal mailbox authority',async()=>{
  rpc.mockResolvedValue({data:false,error:null});await expect(readVoiceMailboxAudio(db,call,actor,ws)).rejects.toMatchObject({code:'notFound'});expect(sign).not.toHaveBeenCalled();
 });
 it('fails closed when access metadata is unavailable',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'private detail'}});await expect(readVoiceMailboxAudio(db,call,actor,ws)).rejects.toMatchObject({code:'unavailable'});expect(sign).not.toHaveBeenCalled();
 });
 it('does not promise audio when the provider object is not available',async()=>{
  sign.mockResolvedValue({data:null,error:{message:'missing'}});expect(await readVoiceMailboxAudio(db,call,actor,ws)).toBeNull();
 });
 it('does not return a signed credential after permission changes during Storage access',async()=>{
  rpc.mockResolvedValueOnce({data:true,error:null}).mockResolvedValue({data:false,error:null});
  await expect(readVoiceMailboxAudio(db,call,actor,ws)).rejects.toMatchObject({code:'notFound'});expect(sign).toHaveBeenCalledOnce();
 });
 it('distinguishes recorded inbound fallback from answering machines and AI',()=>{
  const original={direction:'inbound',agent_id:null,context:{voice_mailbox:{enabled:true,version:1,maxSeconds:60}}};
  expect(isVoiceMailboxCall(original)).toBe(true);expect(isVoiceMailboxCall({...original,direction:'outbound'})).toBe(false);expect(isVoiceMailboxCall({...original,agent_id:actor})).toBe(false);expect(isVoiceMailboxCall({...original,context:{}})).toBe(false);
 });
});
