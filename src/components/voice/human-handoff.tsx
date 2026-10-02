'use client';
import {useEffect,useRef,useState} from 'react';
import {useWorkspace} from '@/hooks/use-workspace';
import {useT} from '@/hooks/use-locale';
import {useFetchWithCsrf} from '@/lib/api/fetch-with-csrf';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {humanAudioGrant,humanHandoffSnapshot,type HumanHandoffSnapshot} from '@/lib/voice/human-handoff-contract';
import type {HumanAudioConnection} from '@/lib/voice/human-audio';
const active=['requested','ready','connected'],codes=['invalid','notFound','changed','readOnly','unavailable'];
export function HumanVoiceHandoff({callId}:{callId:string}){
 const t=useT(),fetch=useFetchWithCsrf(),{workspace}=useWorkspace(),workspaceId=workspace?.id;
 const [snapshot,setSnapshot]=useState<HumanHandoffSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[muted,setMuted]=useState(false),[audioConnected,setAudioConnected]=useState(false);
 const audio=useRef<HumanAudioConnection|null>(null),current=useRef<HumanHandoffSnapshot|null>(null),version=useRef(0),attempt=useRef(''),inFlight=useRef(false),joining=useRef(false);
 const joinAbort=useRef<AbortController|null>(null);
 const mutationEpoch=useRef(0);
 const state=snapshot?.job?.state;
 useEffect(()=>{
  if(!SHOW_RIVERZ_IMPROVEMENTS||!workspaceId)return;
  const lifecycleVersion=version,generation=++lifecycleVersion.current;setSnapshot(null);setError('');setBusy(false);setMuted(false);setAudioConnected(false);current.current=null;attempt.current='';inFlight.current=false;joining.current=false;
  let stopped=false,lastRenew=0;
  const request=async(action?:'renew'|'end')=>{
   const job=current.current?.job;
   const response=await fetch(action?'/api/voice/handoff':`/api/voice/handoff?callId=${encodeURIComponent(callId)}`,{method:action?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},...(action?{body:JSON.stringify({action,input:{callId,id:job?.id}})}:{})});
   const value:unknown=await response.json().catch(()=>null);
   if(!response.ok){const code=value&&typeof value==='object'&&'code'in value?value.code:'unavailable';throw new Error(typeof code==='string'&&codes.includes(code)?code:'unavailable');}
   return value;
  };
  const release=()=>{const job=current.current?.job;if(job&&active.includes(job.state))void request('end').catch(()=>undefined);};
  const close=()=>{void audio.current?.close();audio.current=null;setAudioConnected(false);};
  const update=async()=>{
   if(stopped||inFlight.current||joining.current)return;inFlight.current=true;const epoch=mutationEpoch.current;
   try{
    const renew=audio.current&&current.current?.job?.state==='connected'&&Date.now()-lastRenew>=15000;
    const value=await request(renew?'renew':undefined);if(renew)lastRenew=Date.now();
    if(stopped||version.current!==generation||mutationEpoch.current!==epoch)return;
    const parsed=humanHandoffSnapshot.safeParse(value);if(!parsed.success||parsed.data.call_id!==callId||parsed.data.workspace_id!==workspaceId)throw new Error('unavailable');
    current.current=parsed.data;setSnapshot(parsed.data);setError('');
    if(parsed.data.job&&!active.includes(parsed.data.job.state))close();
   }catch(cause){if(!stopped&&version.current===generation&&mutationEpoch.current===epoch){setError(cause instanceof Error&&codes.includes(cause.message)?cause.message:'unavailable');if(audio.current){close();release();}}}
   finally{if(version.current===generation)inFlight.current=false;}
  };
  const leave=()=>{joinAbort.current?.abort();joinAbort.current=null;close();release();};
  void update();const timer=setInterval(()=>void update(),5000);window.addEventListener('pagehide',leave);
  return()=>{stopped=true;lifecycleVersion.current++;clearInterval(timer);window.removeEventListener('pagehide',leave);leave();};
 },[callId,workspaceId,fetch]);
 if(!SHOW_RIVERZ_IMPROVEMENTS)return null;
 async function run(action:'request'|'join'|'end'){
  if(!workspaceId||busy)return;const generation=version.current;mutationEpoch.current++;setBusy(true);setError('');joining.current=true;
  let joined:HumanAudioConnection|null=null;
  try{
   if(action==='request'&&!attempt.current)attempt.current=crypto.randomUUID();const id=action==='request'?attempt.current:current.current?.job?.id;
   if(!id)throw new Error('invalid');
   if(action==='end'){await audio.current?.close();audio.current=null;setAudioConnected(false);}
   const response=await fetch('/api/voice/handoff',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action,input:{callId,id}})});
   const value:unknown=await response.json().catch(()=>null);
   if(version.current!==generation)return;
   if(!response.ok){const code=value&&typeof value==='object'&&'code'in value?value.code:'unavailable';throw new Error(typeof code==='string'&&codes.includes(code)?code:'unavailable');}
   if(action==='join'){
    const grant=humanAudioGrant.safeParse(value);if(!grant.success||grant.data.id!==id||grant.data.callId!==callId)throw new Error('unavailable');
    const abort=new AbortController();joinAbort.current=abort;
    const {connectHumanAudio}=await import('@/lib/voice/human-audio');
    if(version.current!==generation||abort.signal.aborted)return;
    joined=await connectHumanAudio(grant.data,()=>{if(version.current===generation){void audio.current?.close();audio.current=null;setAudioConnected(false);setError('changed');void fetch('/api/voice/handoff',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'end',input:{callId,id}})}).catch(()=>undefined);}},abort.signal);
    if(version.current!==generation){await joined.close();return;}audio.current=joined;setAudioConnected(true);setMuted(false);
   }else{
    if(action==='end'&&value&&typeof value==='object'&&'released'in value&&value.released===true){setSnapshot(null);current.current=null;return;}
    const parsed=humanHandoffSnapshot.safeParse(value);if(!parsed.success||parsed.data.call_id!==callId||parsed.data.workspace_id!==workspaceId||parsed.data.job?.id!==id)throw new Error('unavailable');
    current.current=parsed.data;setSnapshot(parsed.data);
   }
  }catch(cause){if(version.current===generation){await joined?.close();setError(cause instanceof Error&&codes.includes(cause.message)?cause.message:'unavailable');
   if(action==='join'&&current.current?.job)void fetch('/api/voice/handoff',{method:'POST',headers:{'Content-Type':'application/json','x-workspace-id':workspaceId},body:JSON.stringify({action:'end',input:{callId,id:current.current.job.id}})}).catch(()=>undefined);
  }}
  finally{if(version.current===generation){setBusy(false);joining.current=false;}}
 }
 async function toggleMute(){try{await audio.current?.mute(!muted);setMuted(!muted);}catch{setError('unavailable');await audio.current?.close();audio.current=null;setAudioConnected(false);}}
 return <details className="rounded-lg border border-border bg-card p-3" data-voice-handoff><summary className="cursor-pointer text-sm font-medium">{t('voice.handoffTitle')}</summary><div className="mt-3 space-y-3 text-sm">
  <p className="text-muted-foreground">{t('voice.handoffDescription')}</p>
  <p role="status">{t(state?`voice.handoffState_${state}`:snapshot?.runtime_available?'voice.handoffAvailable':'voice.handoffChecking')}</p>
  {error&&<p role="alert" className="text-destructive">{t(`voice.handoffError_${error}`)}</p>}
  <div className="flex flex-wrap gap-2">
   {!snapshot?.job&&<button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy||!snapshot?.runtime_available} onClick={()=>void run('request')}>{t('voice.handoffRequest')}</button>}
   {state==='ready'&&!audioConnected&&<button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={()=>void run('join')}>{t('voice.handoffJoin')}</button>}
   {audioConnected&&<button type="button" className="rounded border px-3 py-2" onClick={()=>void toggleMute()}>{t(muted?'voice.handoffUnmute':'voice.handoffMute')}</button>}
   {state&&active.includes(state)&&<button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={()=>void run('end')}>{t('voice.handoffEnd')}</button>}
  </div>
  {audioConnected&&<p className="text-muted-foreground">{t('voice.handoffAudioConnected')}</p>}
  {!snapshot?.runtime_available&&!snapshot?.job&&<p className="text-muted-foreground">{t('voice.handoffUnavailable')}</p>}
  <p className="text-muted-foreground text-xs">{t('voice.handoffCosts')}</p>
 </div></details>;
}
