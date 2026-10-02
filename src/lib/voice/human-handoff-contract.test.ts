import {describe,expect,it} from 'vitest';
import {humanHandoffInput,humanHandoffSnapshot,humanRuntimeRegistration,humanRuntimeAck,humanParticipantIdentity} from './human-handoff-contract';
const call='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
const job={id,call_id:call,workspace_id:workspace,actor_id:actor,state:'requested',expires_at:'2026-10-02T10:01:00Z',created_at:'2026-10-02T10:00:00Z',updated_at:'2026-10-02T10:00:00Z',joined_at:null,ended_at:null,reason:null};
const snapshot={call_id:call,workspace_id:workspace,actor_id:actor,runtime_available:true,job};
describe('Human voice control has exact immutable scope',()=>{
 it('accepts a pending handoff without describing it as joined',()=>{expect(humanHandoffSnapshot.parse(snapshot).job?.state).toBe('requested');expect(humanParticipantIdentity(id)).toBe('human_'+id);});
 it.each([{...snapshot,workspace_id:actor},{...snapshot,actor_id:workspace},{...snapshot,call_id:workspace},{...snapshot,token:'PRIVATE'},{...snapshot,job:{...job,state:'connected'}},{...snapshot,job:{...job,state:'ended'}},{...snapshot,job:{...job,state:'requested',joined_at:job.created_at}},{...snapshot,job:{...job,expires_at:job.created_at}}])('rejects crossed or internally inconsistent snapshots',value=>{expect(humanHandoffSnapshot.safeParse(value).success).toBe(false);});
 it('does not accept a browser-supplied room, actor, target or metadata',()=>{expect(humanHandoffInput.safeParse({id,callId:call}).success).toBe(true);for(const extra of [{room:'other'},{actorId:workspace},{target:'sip:other'},{token:'PRIVATE'}])expect(humanHandoffInput.safeParse({id,callId:call,...extra}).success).toBe(false);});
 it('bounds worker runtime identifiers and phases',()=>{
  expect(humanRuntimeRegistration.safeParse({callId:call,workerId:id,room:'voice_'+call,customerIdentity:'caller-'+call}).success).toBe(true);
  expect(humanRuntimeRegistration.safeParse({callId:call,workerId:id,room:'https://other',customerIdentity:'caller'}).success).toBe(false);
  expect(humanRuntimeAck.safeParse({callId:call,workerId:id,id,phase:'connected',actorId:actor}).success).toBe(false);
 });
});
