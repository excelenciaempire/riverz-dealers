import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
export class ReturnAccessError extends Error{constructor(readonly code:'forbidden'|'unavailable'){super(code);}}
/** Metadata-only gate. Never read a return body before validating its current case visibility. */
export async function visibleReturnIds(db:SupabaseClient,workspaceId:string,actorId:string,ids:string[]):Promise<Set<string>>{
 const parsed=z.array(z.string().uuid()).max(200).safeParse(ids);
 if(!parsed.success)throw new ReturnAccessError('unavailable');
 const result=await db.rpc('visible_return_case_ids',{p_workspace_id:workspaceId,p_actor_id:actorId,p_ids:parsed.data});
 if(result.error)throw new ReturnAccessError(result.error.message==='return_access_forbidden'?'forbidden':'unavailable');
 const visible=z.array(z.string().uuid()).max(200).safeParse(result.data);
 if(!visible.success||visible.data.some(id=>!ids.includes(id)))throw new ReturnAccessError('unavailable');return new Set(visible.data);
}
