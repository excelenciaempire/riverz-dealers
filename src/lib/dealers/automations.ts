import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isDealerDeployment } from './config';
export const DEALER_EVENTS = [
  'dealer_follow_up_due',
  'dealer_appointment_reminder',
] as const;
export class DealerAutomationStopped extends Error {
  constructor() {
    super('dealer_follow_up_stopped');
  }
}
export async function enqueueDealerAutomations(
  db: SupabaseClient
): Promise<number> {
  if (!isDealerDeployment()) return 0;
  const result = await db.rpc('enqueue_dealer_automation_events');
  if (result.error) throw new Error(result.error.message);
  return Number(result.data ?? 0);
}
export async function assertDealerAutomationAllowed(
  db: SupabaseClient,
  workspace: string,
  contact: string | null,
  event: string,
  vars: Record<string, unknown> = {}
) {
  if (!(DEALER_EVENTS as readonly string[]).includes(event)) return;
  if (!contact || !isDealerDeployment()) throw new DealerAutomationStopped();
  const result = await db.rpc('dealer_automation_allowed', {
    p_workspace: workspace,
    p_contact: contact,
    p_event: event,
    p_vars: vars,
  });
  if (result.error) throw new Error(result.error.message);
  if (result.data !== true) throw new DealerAutomationStopped();
}
