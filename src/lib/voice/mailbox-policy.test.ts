import {describe,expect,it} from 'vitest';
import {configuredVoiceMailbox,savedVoiceMailbox,isVoiceMailboxCapture} from './mailbox-policy';
const policy={enabled:true,maxSeconds:60,version:1};
const call={direction:'inbound',agent_id:null,context:{fallback_reason:'capacity_unavailable',voice_mailbox:policy}};
const result={status:'completed',outcome_details:{mailbox_capture:'recording_requested'}};
describe('inbound voice mailbox authority and limits',()=>{
 it('is opt-in and inactive in the normal build',()=>{
  expect(configuredVoiceMailbox({},true)).toBeNull();
  expect(configuredVoiceMailbox({fallback_voicemail_enabled:true},false)).toBeNull();
  expect(savedVoiceMailbox(call.context,false)).toBeNull();
 });
 it('defaults a selected mailbox to 60 seconds',()=>expect(configuredVoiceMailbox({fallback_voicemail_enabled:true},true)).toEqual(policy));
 it.each([0,14,121,Infinity,NaN,'60',true,60.5])('rejects unsafe duration %s',maxSeconds=>expect(configuredVoiceMailbox({fallback_voicemail_enabled:true,fallback_voicemail_seconds:maxSeconds},true)).toBeNull());
 it('uses the saved call decision, not a changed connection',()=>expect(savedVoiceMailbox(call.context,true)).toEqual(policy));
 it.each([{...policy,version:2},{...policy,enabled:false},{...policy,extra:true},null])('rejects incompatible stored decisions',voice_mailbox=>expect(savedVoiceMailbox({voice_mailbox},true)).toBeNull());
 it('recognizes a bounded inbound capture without inventing an AI turn',()=>expect(isVoiceMailboxCapture(call,result)).toBe(true));
 it('does not let an AI or outbound call bypass the silent-agent failure',()=>{
  expect(isVoiceMailboxCapture({...call,agent_id:'agent'},result)).toBe(false);
  expect(isVoiceMailboxCapture({...call,direction:'outbound'},result)).toBe(false);
  expect(isVoiceMailboxCapture({...call,context:{}},result)).toBe(false);
  expect(isVoiceMailboxCapture(call,{...result,status:'failed'})).toBe(false);
  expect(isVoiceMailboxCapture(call,{...result,outcome_details:{mailbox_capture:'stored'}})).toBe(false);
 });
});
