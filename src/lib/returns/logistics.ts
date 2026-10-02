import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {returnLogisticsInput,returnLogisticsPage,type ReturnLogisticsInput} from './logistics-contract';
import {returnStatus} from './decision';
import {parseReturnHistoryCursor} from './history';
export class ReturnLogisticsError extends Error{constructor(readonly code:'invalid'|'forbidden'|'notFound'|'platformManaged'|'changed'|'readOnly'|'limit'|'unavailable'){super(code);}}
function failure(message:string):never{
 const map:Record<string,ReturnLogisticsError['code']>={invalid_return_logistics:'invalid',return_access_forbidden:'forbidden',return_not_found:'notFound',return_platform_managed:'platformManaged',return_decision_changed:'changed',return_logistics_conflict:'changed',return_refund_pending:'changed',invalid_return_transition:'changed',return_subscription_read_only:'readOnly',return_logistics_limit:'limit'};
 throw new ReturnLogisticsError(map[message]??'unavailable');
}
function identity(workspaceId:string,actorId:string,caseId:string){if(![workspaceId,actorId,caseId].every(value=>z.string().uuid().safeParse(value).success))throw new ReturnLogisticsError('invalid');}
export async function readReturnLogistics(db:SupabaseClient,workspaceId:string,actorId:string,caseId:string,cursor?:string){
 identity(workspaceId,actorId,caseId);let sequence:number|null=null;
 try{sequence=cursor?parseReturnHistoryCursor(cursor).event_sequence:null;}catch{throw new ReturnLogisticsError('invalid');}
 const result=await db.rpc('read_return_logistics',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:caseId,p_cursor_sequence:sequence});
 if(result.error)failure(result.error.message);const parsed=returnLogisticsPage.safeParse(result.data);
 if(!parsed.success||parsed.data.case_id!==caseId)throw new ReturnLogisticsError('unavailable');
 if(parsed.data.next_cursor){try{parseReturnHistoryCursor(parsed.data.next_cursor);}catch{throw new ReturnLogisticsError('unavailable');}}
 return parsed.data;
}
/** An authenticated human attestation, never proof of carrier delivery or payment. */
export async function recordReturnLogistics(db:SupabaseClient,workspaceId:string,actorId:string,caseId:string,raw:ReturnLogisticsInput){
 identity(workspaceId,actorId,caseId);const input=returnLogisticsInput.safeParse(raw);if(!input.success)throw new ReturnLogisticsError('invalid');
 const value=input.data;const result=await db.rpc('record_return_logistics',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:caseId,
  p_id:value.id,p_kind:value.kind,p_payload:value.payload,p_expected_updated_at:value.expected_updated_at});
 if(result.error)failure(result.error.message);
 const parsed=z.object({event_id:z.string().uuid(),unchanged:z.boolean(),status:returnStatus,updated_at:z.string().datetime({offset:true})}).strict().safeParse(result.data);
 if(!parsed.success||parsed.data.event_id!==value.id)throw new ReturnLogisticsError('unavailable');return parsed.data;
}
