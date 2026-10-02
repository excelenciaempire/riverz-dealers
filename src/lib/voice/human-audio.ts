'use client';
import {Room,RoomEvent,Track,ParticipantKind,type RemoteParticipant,type RemoteTrackPublication} from 'livekit-client';
import {humanAudioGrant,type HumanAudioGrant} from './human-handoff-contract';
export type HumanAudioConnection={close:()=>Promise<void>;mute:(muted:boolean)=>Promise<void>};
/** Called only by the explicit ready-state Join button. Never during render,
 * polling, navigation, flag-off, or a private comparison fixture. */
export async function connectHumanAudio(input:HumanAudioGrant,onDisconnected:()=>void,signal?:AbortSignal):Promise<HumanAudioConnection>{
 const grant=humanAudioGrant.parse(input);if(Date.parse(grant.expiresAt)<=Date.now())throw new Error('changed');
 if(signal?.aborted)throw new Error('changed');
 const room=new Room({disconnectOnPageLeave:true,reconnectPolicy:{nextRetryDelayInMs:()=>null}}),audio=new Set<HTMLMediaElement>();
 let closing=false;
 const customer=(participant:RemoteParticipant)=>participant.identity===grant.customerIdentity&&participant.kind===ParticipantKind.SIP;
 const subscribe=(publication:RemoteTrackPublication,participant:RemoteParticipant)=>{if(customer(participant)&&publication.kind===Track.Kind.Audio)publication.setSubscribed(true);};
 const clear=()=>{for(const element of audio){element.pause();element.srcObject=null;element.remove();}audio.clear();};
 const abort=()=>{void close();};
 const close=async()=>{if(closing)return;closing=true;signal?.removeEventListener('abort',abort);clear();await room.disconnect(true);};
 signal?.addEventListener('abort',abort,{once:true});
 room.on(RoomEvent.TrackPublished,subscribe);
 room.on(RoomEvent.TrackSubscribed,(track,_publication,participant)=>{
  if(!customer(participant)||track.kind!==Track.Kind.Audio)return;
  const element=track.attach();element.setAttribute('data-riverz-human-audio','true');audio.add(element);document.body.appendChild(element);
 });
 room.on(RoomEvent.Disconnected,()=>{clear();if(!closing){closing=true;signal?.removeEventListener('abort',abort);onDisconnected();}});
 room.on(RoomEvent.ParticipantDisconnected,participant=>{if(customer(participant)){void close();onDisconnected();}});
 try{
  await room.connect(grant.url,grant.token,{autoSubscribe:false});
  if(closing||signal?.aborted)throw new Error('changed');
  for(const participant of room.remoteParticipants.values())for(const publication of participant.audioTrackPublications.values())subscribe(publication,participant);
  await room.startAudio();
  if(closing||signal?.aborted)throw new Error('changed');
  await room.localParticipant.setMicrophoneEnabled(true,{echoCancellation:true,noiseSuppression:true,autoGainControl:true});
  if(closing||signal?.aborted){await room.disconnect(true);throw new Error('changed');}
  return {close,mute:async muted=>{if(!closing)await room.localParticipant.setMicrophoneEnabled(!muted);}};
 }catch(error){await close();throw error;}
}
