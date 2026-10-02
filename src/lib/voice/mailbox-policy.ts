import {z} from 'zod';

// This is a recorded inbound fallback, not an outbound answering machine.
export const voiceMailboxPolicy = z.object({
  enabled: z.boolean(),
  maxSeconds: z.number().int().min(15).max(120),
  version: z.literal(1),
}).strict();
export type VoiceMailboxPolicy = z.infer<typeof voiceMailboxPolicy>;
export function configuredVoiceMailbox(config: Record<string, unknown>, enabled: boolean): VoiceMailboxPolicy | null {
  if (!enabled || config.fallback_voicemail_enabled !== true) return null;
  const value = voiceMailboxPolicy.safeParse({enabled:true,maxSeconds:config.fallback_voicemail_seconds ?? 60,version:1});
  return value.success ? value.data : null;
}
export function savedVoiceMailbox(context: Record<string, unknown>, enabled: boolean): VoiceMailboxPolicy | null {
  if (!enabled) return null;
  const value=voiceMailboxPolicy.safeParse(context.voice_mailbox);
  return value.success && value.data.enabled ? value.data : null;
}
export function isVoiceMailboxCapture(call: {direction:string;agent_id:string|null;context:Record<string,unknown>}, payload: {status:string;outcome_details?:Record<string,unknown>|null}): boolean {
  const policy=voiceMailboxPolicy.safeParse(call.context.voice_mailbox);
  return call.direction==='inbound' && call.agent_id===null && typeof call.context.fallback_reason==='string'
    && policy.success && policy.data.enabled && payload.status==='completed'
    && payload.outcome_details?.mailbox_capture==='recording_requested';
}
