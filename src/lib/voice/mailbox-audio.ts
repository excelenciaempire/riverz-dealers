import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {savedVoiceMailbox} from './mailbox-policy';
export class VoiceMailboxAudioError extends Error {
  constructor(public readonly code:'notFound'|'unavailable'){super(code);}
}
export function isVoiceMailboxCall(call:{direction:string;agent_id:string|null;context:Record<string,unknown>}) {
  return call.direction==='inbound' && call.agent_id===null && savedVoiceMailbox(call.context,true)!==null;
}
export async function readVoiceMailboxAudio(db:SupabaseClient,call:{id:string;workspace_id:string},actorId:string,selectedWorkspaceId:string|null):Promise<string|null> {
  if(selectedWorkspaceId!==call.workspace_id || ![call.id,call.workspace_id,actorId].every(x=>z.string().uuid().safeParse(x).success))throw new VoiceMailboxAudioError('notFound');
  const access=await db.rpc('voice_human_access',{p_workspace_id:call.workspace_id,p_actor_id:actorId,p_call_id:call.id});
  if(access.error)throw new VoiceMailboxAudioError('unavailable');
  if(access.data!==true)throw new VoiceMailboxAudioError('notFound');
  // Deterministic private object only. No worker-supplied recording URL.
  const signed=await db.storage.from('voice-recordings').createSignedUrl(`${call.id}.ogg`,60);
  const current=await db.rpc('voice_human_access',{p_workspace_id:call.workspace_id,p_actor_id:actorId,p_call_id:call.id});
  if(current.error)throw new VoiceMailboxAudioError('unavailable');
  if(current.data!==true)throw new VoiceMailboxAudioError('notFound');
  return signed.error ? null : signed.data?.signedUrl ?? null;
}
