import 'server-only';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
/** Preserve existing measured STT. A missing measurement must never turn the
 * entire human segment into an AI transcription charge. The fallback is bounded
 * by the server's immutable acknowledgement that AI closed and tools drained. */
export async function controlledVoiceSttSeconds(db:SupabaseClient,callId:string,duration:number,measured:number|undefined){
 if(measured!==undefined){if(!Number.isFinite(measured)||measured<0)throw new Error('voice_usage_invalid');return measured;}
 if(!Number.isFinite(duration)||duration<0)throw new Error('voice_usage_invalid');
 if(!SHOW_RIVERZ_IMPROVEMENTS)return duration;
 const {data,error}=await db.rpc('voice_human_media_boundary',{p_call_id:callId});if(error)throw new Error('voice_usage_boundary_unavailable');
 if(data===null)return duration;
 const parsed=z.object({call_id:z.string().uuid(),answered_at:z.string().datetime({offset:true}),ai_stopped_at:z.string().datetime({offset:true})}).strict().safeParse(data);
 if(!parsed.success||parsed.data.call_id!==callId)throw new Error('voice_usage_boundary_unavailable');
 return Math.min(duration,Math.max(0,(Date.parse(parsed.data.ai_stopped_at)-Date.parse(parsed.data.answered_at))/1000));
}
