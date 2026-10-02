import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {assertWorkspaceWritable,BillingReadOnlyError} from '@/lib/billing/read-only';
import {caseOrderSnapshot} from '@/lib/inbox/order-actions';
import {refundMoney} from '@/lib/shopify/refund-plan';
import {limitByKey} from '@/lib/rate-limit';
import {returnRefundInput,returnRefundContext,preparedReturnRefund,type ReturnRefundInput} from './refund-link-contract';
export class ReturnRefundError extends Error{constructor(readonly code:'invalid'|'notFound'|'changed'|'pending'|'readOnly'|'receiptRequired'|'limited'|'unavailable'){super(code);}}
function failure(message:string):never{
 const codes:Record<string,ReturnRefundError['code']>={invalid_return_refund:'invalid',return_not_found:'notFound',return_refund_changed:'changed',return_refund_pending:'pending',return_subscription_read_only:'readOnly',return_refund_receipt_required:'receiptRequired',order_action_conflict:'changed',return_refund_unavailable:'unavailable'};
 throw new ReturnRefundError(codes[message]??'unavailable');
}
function identity(workspaceId:string,actorId:string,caseId:string){if(![workspaceId,actorId,caseId].every(value=>z.string().uuid().safeParse(value).success))throw new ReturnRefundError('invalid');}
export async function readReturnRefundContext(db:SupabaseClient,workspaceId:string,actorId:string,caseId:string){
 identity(workspaceId,actorId,caseId);const result=await db.rpc('read_return_refund_context',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:caseId});
 if(result.error)failure(result.error.message);const parsed=returnRefundContext.safeParse(result.data);if(!parsed.success||parsed.data.case_id!==caseId)throw new ReturnRefundError('unavailable');return parsed.data;
}
/** Read the live paid balance and prepare through the existing shared engine.
 * Never claim an operation or call a refund provider from this service. */
export async function prepareReturnRefund(db:SupabaseClient,workspaceId:string,actorId:string,caseId:string,raw:ReturnRefundInput){
 identity(workspaceId,actorId,caseId);const parsed=returnRefundInput.safeParse(raw);if(!parsed.success)throw new ReturnRefundError('invalid');
 const input=parsed.data,context=await readReturnRefundContext(db,workspaceId,actorId,caseId);
 if(context.receipt.id!==input.receipt_id)throw new ReturnRefundError('changed');
 try{await assertWorkspaceWritable(db,workspaceId);}catch(error){throw new ReturnRefundError(error instanceof BillingReadOnlyError?'readOnly':'unavailable');}
 try{if(!(await limitByKey(`return-refund-preview:${workspaceId}:${actorId}`,{limit:30,windowMs:60_000})).success)throw new ReturnRefundError('limited');}
 catch(error){if(error instanceof ReturnRefundError)throw error;throw new ReturnRefundError('unavailable');}
 const action={type:'refund' as const,amount:input.amount,reason:input.reason};
 let snapshot:Awaited<ReturnType<typeof caseOrderSnapshot>>;
 try{snapshot=await caseOrderSnapshot(db,workspaceId,context.contact_id,context.order_id,action);}catch{throw new ReturnRefundError('unavailable');}
 if((refundMoney(snapshot.preview.amount)??BigInt(0))<=BigInt(0))throw new ReturnRefundError('unavailable');
 const result=await db.rpc('prepare_return_refund_preview',{p_workspace_id:workspaceId,p_actor_id:actorId,p_case_id:caseId,p_receipt_id:input.receipt_id,p_id:input.id,p_action:action,p_preview:snapshot.preview,p_fingerprint:snapshot.fingerprint});
 if(result.error)failure(result.error.message);
 const stored=z.object({case_id:z.string().uuid(),conversation_id:z.string().uuid(),operation:z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),conversation_id:z.string().uuid(),order_id:z.string().uuid(),requested_by:z.string().uuid(),
  action:z.object({type:z.literal('refund'),amount:z.number().nullable(),reason:z.string()}).strict(),status:preparedReturnRefund.shape.status,expires_at:preparedReturnRefund.shape.expires_at,
  preview:z.object({amount:preparedReturnRefund.shape.amount,currency:preparedReturnRefund.shape.currency,return_receipt:z.object({version:z.literal(1),case_id:z.string().uuid(),receipt_id:z.string().uuid(),reference:z.string(),condition:z.enum(['accepted','damaged','incomplete']),quantity:z.number().int(),recorded_at:z.string()}).strict()})})}).strict().safeParse(result.data);
 if(!stored.success)throw new ReturnRefundError('unavailable');const value=stored.data,op=value.operation,marker=op.preview.return_receipt;
 if(value.case_id!==caseId||value.conversation_id!==context.conversation_id||op.id!==input.id||op.workspace_id!==workspaceId||op.conversation_id!==context.conversation_id||op.order_id!==context.order_id||op.requested_by!==actorId
  ||op.action.amount!==input.amount||op.action.reason!==input.reason||(input.amount!==null&&refundMoney(op.preview.amount)!==refundMoney(input.amount))||marker.case_id!==caseId||marker.receipt_id!==input.receipt_id||marker.reference!==context.receipt.reference||marker.condition!==context.receipt.condition||marker.quantity!==context.receipt.quantity||marker.recorded_at!==context.receipt.recorded_at)throw new ReturnRefundError('unavailable');
 return preparedReturnRefund.parse({case_id:caseId,conversation_id:value.conversation_id,operation_id:op.id,status:op.status,amount:op.preview.amount,currency:op.preview.currency,expires_at:op.expires_at,receipt:context.receipt});
}
