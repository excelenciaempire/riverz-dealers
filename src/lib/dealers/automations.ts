import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isDealerDeployment } from './config';
import { fromZonedTime,formatInTimeZone } from 'date-fns-tz';
import { readDealerSettings } from './settings-server';
import { dealerBusinessTime,type DealerSettings } from './settings';
export const DEALER_EVENTS = [
  'dealer_follow_up_due',
  'dealer_appointment_reminder',
  'dealer_no_show',
  'dealer_post_visit',
] as const;
export class DealerAutomationStopped extends Error {
  constructor() {
    super('dealer_follow_up_stopped');
  }
}
export class DealerAutomationDeferred extends Error {
  constructor(public runAt:string){super('dealer_outside_sending_hours');}
}
export function nextDealerSendAt(settings:DealerSettings,now=Date.now()):string|null {
  const s=settings.follow_up,timezone=settings.business.timezone,time=dealerBusinessTime(now,timezone);
  if(s.weekdays.includes(time.day)&&time.hour>=s.start_hour&&time.hour<s.end_hour)return null;
  const day0=formatInTimeZone(now,timezone,'yyyy-MM-dd');
  for(let d=0;d<8;d++) {
    const day=new Date(`${day0}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+d);
    const start=fromZonedTime(`${day.toISOString().slice(0,10)}T${String(s.start_hour).padStart(2,'0')}:00:00`,timezone).getTime();
    if(start>now&&s.weekdays.includes(dealerBusinessTime(start,timezone).day))return new Date(start).toISOString();
  }
  throw new DealerAutomationStopped();
}
export async function assertDealerSendWindow(db:SupabaseClient,workspace:string,event:string) {
  if(!(DEALER_EVENTS as readonly string[]).includes(event))return;
  const {settings}=await readDealerSettings(db,workspace);if(!settings.follow_up.enabled)throw new DealerAutomationStopped();
  const at=nextDealerSendAt(settings);if(at)throw new DealerAutomationDeferred(at);
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
