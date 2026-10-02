import {z} from 'zod';
const uuid=z.string().uuid(),time=z.string().datetime({offset:true});
export const humanHandoffInput=z.object({id:uuid,callId:uuid}).strict();
export const humanHandoffState=z.enum(['requested','ready','connected','ended','failed','expired']);
export const humanHandoffReason=z.enum(['access_revoked','runtime_stale','call_ended','handshake_timeout','ended_by_human','worker_failed']);
export const humanHandoffJob=z.object({id:uuid,call_id:uuid,workspace_id:uuid,actor_id:uuid,state:humanHandoffState,
 expires_at:time,created_at:time,updated_at:time,joined_at:time.nullable(),ended_at:time.nullable(),reason:humanHandoffReason.nullable()}).strict()
 .superRefine((value,ctx)=>{
  if(Date.parse(value.expires_at)<=Date.parse(value.created_at)||value.state==='connected'&&value.joined_at===null||
   ['requested','ready'].includes(value.state)&&value.joined_at!==null||['ended','failed','expired'].includes(value.state)!==(value.ended_at!==null))ctx.addIssue({code:'custom',message:'voice_handoff_snapshot_invalid'});
 });
export const humanHandoffSnapshot=z.object({call_id:uuid,workspace_id:uuid,actor_id:uuid,runtime_available:z.boolean(),job:humanHandoffJob.nullable()}).strict()
 .refine(value=>!value.job||value.job.call_id===value.call_id&&value.job.workspace_id===value.workspace_id&&value.job.actor_id===value.actor_id);
export type HumanHandoffSnapshot=z.infer<typeof humanHandoffSnapshot>;
export type HumanHandoffJob=z.infer<typeof humanHandoffJob>;
export const humanRuntimeRegistration=z.object({callId:uuid,workerId:uuid,room:z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/),
 customerIdentity:z.string().min(1).max(128).regex(/^[A-Za-z0-9_+.:@-]+$/)}).strict();
export const humanRuntimePoll=z.object({callId:uuid,workerId:uuid}).strict();
export const humanRuntimeRelease=humanRuntimePoll.extend({id:uuid}).strict();
export const humanRuntimeAck=z.object({callId:uuid,workerId:uuid,id:uuid,phase:z.enum(['ready','connected','ended','failed'])}).strict();
export const humanParticipantIdentity=(id:string)=>`human_${uuid.parse(id)}`;
export const humanAudioGrant=z.object({id:uuid,callId:uuid,url:z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='wss:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/';}),
 token:z.string().min(1).max(8192),customerIdentity:z.string().min(1).max(128).regex(/^[A-Za-z0-9_+.:@-]+$/),expiresAt:time}).strict();
export type HumanAudioGrant=z.infer<typeof humanAudioGrant>;
