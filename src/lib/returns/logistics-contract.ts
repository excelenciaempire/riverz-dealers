import {z} from 'zod';
import {returnStatus} from './decision';
const date=z.string().datetime({offset:true}).refine(value=>Number.isFinite(Date.parse(value)));
export const returnGuide=z.object({carrier:z.string().trim().min(1).max(80),tracking_number:z.string().trim().min(1).max(100)}).strict();
export const returnReceipt=z.object({reference:z.string().trim().min(1).max(100),quantity:z.number().int().min(1).max(10000),
 condition:z.enum(['accepted','damaged','incomplete']),received_at:date,note:z.string().trim().max(500)}).strict();
const metadata={id:z.string().uuid(),actor_id:z.string().uuid(),event_sequence:z.number().int().positive().safe(),recorded_at:date};
export const returnLogisticsEvent=z.discriminatedUnion('kind',[
 z.object({...metadata,kind:z.literal('guide'),payload:returnGuide}).strict(),
 z.object({...metadata,kind:z.literal('receipt'),payload:returnReceipt}).strict(),
]);
export const returnLogisticsPage=z.object({case_id:z.string().uuid(),status:returnStatus,updated_at:date,platform:z.string().nullable(),
 events:z.array(returnLogisticsEvent).max(20),next_cursor:z.string().min(1).max(512).nullable()}).strict();
const input={id:z.string().uuid(),expected_updated_at:date};
export const returnLogisticsInput=z.discriminatedUnion('kind',[
 z.object({...input,kind:z.literal('guide'),payload:returnGuide}).strict(),
 z.object({...input,kind:z.literal('receipt'),payload:returnReceipt}).strict(),
]);
export type ReturnLogisticsInput=z.infer<typeof returnLogisticsInput>;
export type ReturnLogisticsPage=z.infer<typeof returnLogisticsPage>;
