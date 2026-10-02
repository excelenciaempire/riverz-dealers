import {z} from 'zod';
import {refundMoney} from '@/lib/shopify/refund-plan';
const date=z.string().datetime({offset:true}).refine(value=>Number.isFinite(Date.parse(value)));
export const returnRefundReceipt=z.object({id:z.string().uuid(),reference:z.string().min(1).max(100),condition:z.enum(['accepted','damaged','incomplete']),quantity:z.number().int().min(1).max(10000),recorded_at:date}).strict();
export const returnRefundContext=z.object({case_id:z.string().uuid(),order_id:z.string().uuid(),contact_id:z.string().uuid(),conversation_id:z.string().uuid(),receipt:returnRefundReceipt}).strict();
export const returnRefundInput=z.object({id:z.string().uuid(),receipt_id:z.string().uuid(),amount:z.number().finite().positive().refine(value=>(refundMoney(value)??BigInt(0))>BigInt(0)).nullable(),reason:z.string().trim().min(1).max(300)}).strict();
export const preparedReturnRefund=z.object({case_id:z.string().uuid(),conversation_id:z.string().uuid(),operation_id:z.string().uuid(),status:z.enum(['preview','running','completed','failed','uncertain','expired','reviewed']),
 amount:z.string().regex(/^\d{1,14}(\.\d{1,6})?$/),currency:z.string().regex(/^[A-Z]{3}$/),expires_at:date,receipt:returnRefundReceipt}).strict();
export type ReturnRefundInput=z.infer<typeof returnRefundInput>;
export type ReturnRefundContext=z.infer<typeof returnRefundContext>;
export type PreparedReturnRefund=z.infer<typeof preparedReturnRefund>;
