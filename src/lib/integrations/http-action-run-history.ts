import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {HttpActionStoreError} from './http-action-store';
import {httpRunCursor,httpRunHistory} from './http-action-run-history-contract';
export function httpRunQuery(params:URLSearchParams) {
 const keys=[...params.keys()];if(keys.some(key=>key!=='cursor')||params.getAll('cursor').length>1)throw new HttpActionStoreError('invalid');
 const raw=params.get('cursor');if(raw===null)return null;
 if(!raw||raw.length>400)throw new HttpActionStoreError('invalid');
 try{return httpRunCursor.parse(JSON.parse(raw));}catch{throw new HttpActionStoreError('invalid');}
}
/** Only metadata; customer parameters, responses, hashes and credentials are never returned. */
export async function loadHttpRunHistory(db:SupabaseClient,workspaceId:string,actorId:string,actionId:string,cursor:z.infer<typeof httpRunCursor>|null) {
 const result=await db.rpc('read_http_action_runs',{p_workspace_id:workspaceId,p_actor_id:actorId,p_action_id:actionId,p_cursor_at:cursor?.created_at??null,p_cursor_id:cursor?.id??null});
 if(result.error){const code=result.error.message==='http_action_admin_required'?'forbidden':result.error.message==='invalid_http_action_context'?'not_found':'unavailable';throw new HttpActionStoreError(code);}
 const parsed=httpRunHistory.safeParse(result.data);if(!parsed.success)throw new HttpActionStoreError('unavailable');return parsed.data;
}
