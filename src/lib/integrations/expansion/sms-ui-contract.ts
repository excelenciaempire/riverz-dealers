import {z} from 'zod';
import {smsCost,smsEncoding,smsPhone,smsProviderStatus} from './sms-contract';
const uuid=z.string().uuid(),opaque=z.string().min(1).max(128).refine(value=>!/[\s\u0000-\u001f\u007f]/u.test(value));
export const smsProviderIdentity=z.object({phoneNumberId:opaque,phone:smsPhone,profileId:uuid,organizationId:opaque}).strict();
export type SmsProviderIdentity=z.infer<typeof smsProviderIdentity>;
export const smsPublicKey=z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/);
export const smsSettingsInput=z.object({identity:smsProviderIdentity,key:z.string().max(4096).optional(),publicKey:smsPublicKey.optional(),enabled:z.boolean(),maxSegments:z.number().int().min(1).max(10),dailySegments:z.number().int().min(1).max(10000)}).strict();
export const smsSettings=z.discriminatedUnion('configured',[
 z.object({configured:z.literal(false),enabled:z.literal(false)}).strict(),
 z.object({configured:z.literal(true),connectionId:uuid,revision:uuid,phoneNumberId:opaque,phone:smsPhone,profileId:uuid,organizationId:opaque,enabled:z.boolean(),maxSegments:z.number().int().min(1).max(10),dailySegments:z.number().int().min(1).max(10000),inboundQueue:z.object({pending:z.number().int().nonnegative(),failed:z.number().int().nonnegative()}).strict().optional()}).strict(),
]);
export const smsPeerPolicy=z.object({connectionId:uuid,phone:smsPhone,revision:uuid,enabled:z.boolean(),maxSegments:z.number().int().min(1).max(10),dailySegments:z.number().int().min(1).max(10000),consent:z.boolean(),consentSource:z.enum(['human','START','STOP']).nullable(),consentAt:z.string().nullable()}).strict();
export const smsReceipt=z.object({attemptId:uuid,conversationId:uuid,contactId:uuid,peer:smsPhone,text:z.string().max(6700),segments:z.number().int().min(1).max(10),state:z.enum(['reviewed','dispatching','accepted','uncertain','canceled']),providerStatus:smsProviderStatus.nullable(),providerParts:z.number().int().min(1).max(10).nullable(),cost:smsCost.strip().nullable(),deliveryConfirmed:z.boolean(),createdAt:z.string(),updatedAt:z.string()}).strict();
export type NativeSmsReceipt=z.infer<typeof smsReceipt>;
export const smsReviewInput=z.object({attemptId:uuid,conversationId:uuid,contactId:uuid,connectionId:uuid,revision:uuid,peer:smsPhone,text:z.string().refine(value=>smsEncoding(value)!==null),confirmed:z.literal(true)}).strict();
