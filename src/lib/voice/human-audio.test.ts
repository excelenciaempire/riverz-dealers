import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({handlers:new Map<string,(...args:unknown[])=>void>(),connect:vi.fn(),disconnect:vi.fn(),startAudio:vi.fn(),microphone:vi.fn(),participants:new Map(),options:null as unknown}));
vi.mock('livekit-client',()=>({ParticipantKind:{SIP:3},Track:{Kind:{Audio:'audio'}},RoomEvent:{TrackPublished:'published',TrackSubscribed:'subscribed',Disconnected:'disconnected',ParticipantDisconnected:'departed'},Room:class {
 constructor(options:unknown){h.options=options;}on(name:string,fn:(...args:unknown[])=>void){h.handlers.set(name,fn);return this;}connect=h.connect;disconnect=h.disconnect;startAudio=h.startAudio;remoteParticipants=h.participants;localParticipant={setMicrophoneEnabled:h.microphone};
}}));
import {connectHumanAudio} from './human-audio';
const id='11111111-1111-4111-8111-111111111111',callId='22222222-2222-4222-8222-222222222222';
const grant=()=>({id,callId,url:'wss://fixture.livekit.cloud',token:'FIXTURE_NO_REAL_TOKEN',customerIdentity:'caller-'+callId,expiresAt:new Date(Date.now()+30000).toISOString()});
beforeEach(()=>{h.handlers.clear();h.participants.clear();h.options=null;for(const fn of [h.connect,h.disconnect,h.startAudio,h.microphone])fn.mockReset().mockResolvedValue(undefined);vi.stubGlobal('document',{body:{appendChild:vi.fn()}});});
afterEach(()=>{vi.unstubAllGlobals();});
describe('Browser human audio uses only an explicit scoped grant',()=>{
 it('does not auto-subscribe to other participants and disables automatic reconnect',async()=>{
  const customerPublication={kind:'audio',setSubscribed:vi.fn()},otherPublication={kind:'audio',setSubscribed:vi.fn()};
  h.participants.set('customer',{identity:'caller-'+callId,kind:3,audioTrackPublications:new Map([['a',customerPublication]])});h.participants.set('other',{identity:'other',kind:3,audioTrackPublications:new Map([['b',otherPublication]])});
  const audio=await connectHumanAudio(grant(),vi.fn());expect(h.connect).toHaveBeenCalledWith('wss://fixture.livekit.cloud','FIXTURE_NO_REAL_TOKEN',{autoSubscribe:false});expect(customerPublication.setSubscribed).toHaveBeenCalledWith(true);expect(otherPublication.setSubscribed).not.toHaveBeenCalled();
  expect((h.options as {reconnectPolicy:{nextRetryDelayInMs:()=>null}}).reconnectPolicy.nextRetryDelayInMs()).toBeNull();expect(h.microphone).toHaveBeenCalledExactlyOnceWith(true,{echoCancellation:true,noiseSuppression:true,autoGainControl:true});await audio.mute(true);expect(h.microphone).toHaveBeenLastCalledWith(false);await audio.close();expect(h.disconnect).toHaveBeenCalledWith(true);
 });
 it('requires a fresh credential before any connection or microphone access',async()=>{await expect(connectHumanAudio({...grant(),expiresAt:new Date(Date.now()-1000).toISOString()},vi.fn())).rejects.toThrow('changed');expect(h.connect).not.toHaveBeenCalled();expect(h.microphone).not.toHaveBeenCalled();});
 it('rejects an aborted join before touching media',async()=>{const abort=new AbortController();abort.abort();await expect(connectHumanAudio(grant(),vi.fn(),abort.signal)).rejects.toThrow('changed');expect(h.connect).not.toHaveBeenCalled();});
 it('cancels a pending join on navigation and never opens its microphone afterward',async()=>{
  let finish!:()=>void;h.connect.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));const abort=new AbortController(),pending=connectHumanAudio(grant(),vi.fn(),abort.signal);abort.abort();finish();await expect(pending).rejects.toThrow('changed');expect(h.microphone).not.toHaveBeenCalled();expect(h.disconnect).toHaveBeenCalledWith(true);
 });
 it('closes a failed permission request instead of leaving the room connected',async()=>{h.microphone.mockRejectedValue(new Error('permission denied'));await expect(connectHumanAudio(grant(),vi.fn())).rejects.toThrow('permission denied');expect(h.disconnect).toHaveBeenCalledWith(true);});
 it('attaches only the exact customer audio and clears DOM/audio when disconnected',async()=>{
  const disconnected=vi.fn(),audio=await connectHumanAudio(grant(),disconnected),element={setAttribute:vi.fn(),pause:vi.fn(),remove:vi.fn(),srcObject:{fixture:true}};
  const track={kind:'audio',attach:vi.fn().mockReturnValue(element)};
  h.handlers.get('subscribed')!(track,{}, {identity:'other',kind:3});expect(track.attach).not.toHaveBeenCalled();
  h.handlers.get('subscribed')!(track,{}, {identity:'caller-'+callId,kind:3});expect(track.attach).toHaveBeenCalledOnce();h.handlers.get('disconnected')!();expect(element.pause).toHaveBeenCalledOnce();expect(element.srcObject).toBeNull();expect(element.remove).toHaveBeenCalledOnce();expect(disconnected).toHaveBeenCalledOnce();await audio.close();
 });
});
