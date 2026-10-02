import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TokenVerifier} from 'livekit-server-sdk';
const mock=vi.hoisted(()=>({participant:vi.fn(),remove:vi.fn(),enabled:true}));
vi.mock('livekit-server-sdk',async importOriginal=>({...await importOriginal<typeof import('livekit-server-sdk')>(),RoomServiceClient:class {getParticipant=mock.participant;removeParticipant=mock.remove;}}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return mock.enabled;}}));
import {ackHumanRuntime,beginControlledVoiceTool,createHumanHandoffGrant,manageHumanHandoff,pollHumanRuntime,readHumanHandoff,registerHumanRuntime,requestHumanHandoff,releaseHumanRuntime} from './human-handoff';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',callId='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',workerId='55555555-5555-4555-8555-555555555555';
const ctx=()=>({id,call_id:callId,workspace_id:ws,actor_id:actor,room:'voice_'+callId,customer_identity:'caller-'+callId,expires_at:new Date(Date.now()+45000).toISOString()});
const runtime=()=>({call_id:callId,worker_id:workerId,id,state:'ready',actor_id:actor,expires_at:new Date(Date.now()+45000).toISOString(),room:'voice_'+callId,customer_identity:'caller-'+callId,tools_pending:false});
function database(){const rpc=vi.fn();return {rpc,db:{rpc} as unknown as SupabaseClient};}
function configuration(){vi.stubEnv('LIVEKIT_URL','wss://fixture.livekit.cloud');vi.stubEnv('LIVEKIT_API_KEY','fixture-key');vi.stubEnv('LIVEKIT_API_SECRET','fixture-signing-secret-with-enough-characters');mock.participant.mockResolvedValue({identity:'caller-'+callId,kind:3,attributes:{'sip.callStatus':'active'}});}
afterEach(()=>{vi.unstubAllEnvs();mock.participant.mockReset();mock.remove.mockReset();mock.enabled=true;});
describe('Scoped human voice grant and trusted worker observations',()=>{
 it('revokes only the bound terminal human identity and refuses active/cross-job removal',async()=>{
  configuration();const {rpc,db}=database();rpc.mockResolvedValue({data:{...runtime(),state:'ended'},error:null});mock.remove.mockResolvedValue({});
  expect(await releaseHumanRuntime(db,{callId,workerId,id})).toBe(true);expect(mock.remove).toHaveBeenCalledWith('voice_'+callId,'human_'+id,{revokeTokenTs:expect.any(BigInt)});
  mock.remove.mockClear();rpc.mockResolvedValue({data:runtime(),error:null});await expect(releaseHumanRuntime(db,{callId,workerId,id})).rejects.toThrow('changed');expect(mock.remove).not.toHaveBeenCalled();
  rpc.mockResolvedValue({data:{...runtime(),state:'ended',id:workerId},error:null});await expect(releaseHumanRuntime(db,{callId,workerId,id})).rejects.toThrow('changed');expect(mock.remove).not.toHaveBeenCalled();
 });
 it('issues only microphone/subscribe access to the acknowledged room with a bounded token',async()=>{
  configuration();const {rpc,db}=database(),context=ctx();rpc.mockResolvedValue({data:context,error:null});
  const grant=await createHumanHandoffGrant(db,ws,actor,{callId,id});
  const claims=await new TokenVerifier('fixture-key','fixture-signing-secret-with-enough-characters').verify(grant.token);
  expect(claims.sub).toBe('human_'+id);expect(claims.video).toEqual({roomJoin:true,room:'voice_'+callId,canPublish:true,canPublishSources:['microphone'],canSubscribe:true,canPublishData:false,canUpdateOwnMetadata:false,canSubscribeMetrics:false,canManageAgentSession:false});
  expect(claims.attributes).toEqual({'riverz.handoff':id,'riverz.actor':actor});expect(claims.sip).toBeUndefined();expect(claims.inference).toBeUndefined();expect(claims.exp!-claims.nbf!).toBeLessThanOrEqual(30);
  expect(rpc).toHaveBeenCalledTimes(2);expect(grant).not.toHaveProperty('customer_identity');expect(grant).not.toHaveProperty('room');
 });
 it.each(['actor','roomExtra','scope','nearExpiry','changedDuringObservation'])('rejects %s instead of minting a broader or stale grant',async mode=>{
  configuration();const {rpc,db}=database(),context=ctx();
  if(mode==='actor')context.actor_id=workerId;if(mode==='scope')context.call_id=workerId;if(mode==='nearExpiry')context.expires_at=new Date(Date.now()+3000).toISOString();
  rpc.mockResolvedValue({data:mode==='roomExtra'?{...context,token:'unexpected'}:context,error:null});
  if(mode==='changedDuringObservation')rpc.mockResolvedValueOnce({data:context,error:null}).mockResolvedValueOnce({data:{...context,room:'other_room'},error:null});
  await expect(createHumanHandoffGrant(db,ws,actor,{callId,id})).rejects.toThrow();
 });
 it.each([{kind:0,attributes:{'sip.callStatus':'active'}},{kind:3,attributes:{'sip.callStatus':'ringing'}},{kind:3,attributes:{}},{kind:3,attributes:{'sip.callStatus':'active'},identity:'other'}])('requires a real answered SIP customer, not a claimed identity: %j',async value=>{
  configuration();const {rpc,db}=database();rpc.mockResolvedValue({data:ctx(),error:null});mock.participant.mockResolvedValue({identity:'caller-'+callId,...value});
  await expect(createHumanHandoffGrant(db,ws,actor,{callId,id})).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('checks the real SIP participant before registering an immutable worker runtime',async()=>{
  configuration();const {rpc,db}=database();rpc.mockResolvedValue({data:true,error:null});expect(await registerHumanRuntime(db,{callId,workerId,room:'voice_'+callId,customerIdentity:'caller-'+callId})).toBe(true);
  expect(rpc).toHaveBeenCalledWith('register_voice_human_runtime',{p_call_id:callId,p_worker_id:workerId,p_room:'voice_'+callId,p_customer_identity:'caller-'+callId});
 });
 it('rejects a cross-call worker poll snapshot',async()=>{const {rpc,db}=database();rpc.mockResolvedValue({data:{...runtime(),call_id:workerId},error:null});await expect(pollHumanRuntime(db,{callId,workerId})).rejects.toThrow('unavailable');});
 it('acknowledges connected only after observing the actor-bound browser participant',async()=>{
  configuration();const {rpc,db}=database();rpc.mockResolvedValueOnce({data:runtime(),error:null}).mockResolvedValueOnce({data:true,error:null});
  mock.participant.mockResolvedValueOnce({identity:'caller-'+callId,kind:3,attributes:{'sip.callStatus':'active'}}).mockResolvedValueOnce({identity:'human_'+id,kind:0,attributes:{'riverz.handoff':id,'riverz.actor':actor}});
  expect(await ackHumanRuntime(db,{callId,workerId,id,phase:'connected'})).toBe(true);expect(rpc.mock.calls[1][0]).toBe('ack_voice_human_handoff');
 });
 it.each(['kind','actor','id','identity'])('never trusts a connected browser with mismatched %s',async mode=>{
  configuration();const {rpc,db}=database();rpc.mockResolvedValue({data:runtime(),error:null});
  const participant={identity:'human_'+id,kind:0,attributes:{'riverz.handoff':id,'riverz.actor':actor}};
  if(mode==='kind')participant.kind=4;if(mode==='actor')participant.attributes['riverz.actor']=workerId;if(mode==='id')participant.attributes['riverz.handoff']=workerId;if(mode==='identity')participant.identity='other';
  mock.participant.mockResolvedValueOnce({identity:'caller-'+callId,kind:3,attributes:{'sip.callStatus':'active'}}).mockResolvedValueOnce(participant);
  await expect(ackHumanRuntime(db,{callId,workerId,id,phase:'connected'})).rejects.toThrow('changed');expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('makes flag-off business tools incur no control RPC or provider work',async()=>{mock.enabled=false;const {rpc,db}=database();expect(await beginControlledVoiceTool(db,callId)).toBeNull();expect(rpc).not.toHaveBeenCalled();expect(mock.participant).not.toHaveBeenCalled();});
 it('rejects backend snapshots belonging to a different actor',async()=>{const {rpc,db}=database();rpc.mockResolvedValue({data:{call_id:callId,workspace_id:ws,actor_id:workerId,runtime_available:true,job:null},error:null});await expect(readHumanHandoff(db,ws,actor,callId)).rejects.toThrow('unavailable');});
 it('allows only a minimal release response after access revocation',async()=>{const {rpc,db}=database();rpc.mockResolvedValue({data:{released:true},error:null});expect(await manageHumanHandoff(db,ws,actor,{id,callId},'end')).toEqual({released:true});await expect(manageHumanHandoff(db,ws,actor,{id,callId},'renew')).rejects.toThrow('unavailable');});
 it('maps RPC failures without exposing private provider messages',async()=>{const {rpc,db}=database();rpc.mockResolvedValue({data:null,error:{message:'private provider secret'}});await expect(requestHumanHandoff(db,ws,actor,{id,callId})).rejects.toThrow('unavailable');});
});
