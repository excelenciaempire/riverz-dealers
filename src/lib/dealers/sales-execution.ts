import type { DealerData, Opportunity } from './types';
export interface SalesAction {
  opportunity: Opportunity;
  reason:
    | 'new_lead'
    | 'confirm_visit'
    | 'prepare_visit'
    | 'recover_no_show'
    | 'visit_recap'
    | 'follow_up'
    | 'next_step'
    | 'record_outcome';
  priority: number;
  at: string;
}
/** One actionable priority per buyer; opted-out/paused/closed buyers never enter. */
export function salesActions(
  data: DealerData,
  now = Date.now()
): SalesAction[] {
  return data.opportunities
    .flatMap((o): SalesAction[] => {
      if (
        ['won', 'lost'].includes(o.stage) ||
        o.follow_up_paused ||
        data.contacts.find((c) => c.id === o.contact_id)?.opted_out
      )
        return [];
      const appointments = data.appointments
        .filter((a) => a.opportunity_id === o.id)
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
      const latest = appointments[0];
      const action = (
        reason: SalesAction['reason'],
        priority: number,
        at = o.created_at
      ) => [{ opportunity: o, reason, priority, at }];
      const hasAttempt =
        data.activities?.some((a) => a.opportunity_id === o.id) ||
        o.first_contact_at;
      if (!hasAttempt && o.stage === 'inquiry' && !latest)
        return action('new_lead', 0);
      if (latest?.status === 'requested' && Date.parse(latest.ends_at) > now)
        return action('confirm_visit', 1, latest.starts_at);
      // Only the seller can classify attendance; an elapsed slot is not a no-show.
      if (
        latest &&
        ['requested', 'confirmed'].includes(latest.status) &&
        Date.parse(latest.ends_at) <= now
      )
        return action('record_outcome', 3, latest.ends_at);
      if (
        latest?.status === 'confirmed' &&
        Date.parse(latest.starts_at) > now &&
        Date.parse(latest.starts_at) <= now + (data.settings?.appointments.reminder_hours??24)*3600000 &&
        (!latest.customer_confirmed ||
          !latest.vehicle_prepared ||
          !latest.directions_sent)
      )
        return action('prepare_visit', 2, latest.starts_at);
      if (
        latest &&
        ['no_show', 'completed'].includes(latest.status) &&
        Date.parse(latest.ends_at) <= now &&
        (!o.last_contact_at ||
          Date.parse(o.last_contact_at) < Date.parse(latest.ends_at))
      )
        return action(
          latest.status === 'no_show' ? 'recover_no_show' : 'visit_recap',
          3,
          latest.ends_at
        );
      if (o.next_follow_up_at && Date.parse(o.next_follow_up_at) <= now)
        return action('follow_up', 4, o.next_follow_up_at);
      if (!o.next_follow_up_at && !latest) return action('next_step', 5);
      return [];
    })
    .sort((a, b) => a.priority - b.priority || a.at.localeCompare(b.at));
}
/** All funnel counts use the same 30-day opportunity cohort, never all-time rates. */
export function salesMetrics(data: DealerData, now = Date.now()) {
  const cohort = data.opportunities.filter(
    (o) =>
      Date.parse(o.created_at) >= now - (data.settings?.metrics.days??30) * 86400000 &&
      Date.parse(o.created_at) <= now
  );
  const ids = new Set(cohort.map((o) => o.id));
  const appointments = data.appointments.filter((a) =>
    ids.has(a.opportunity_id)
  );
  const attended = new Set(
    appointments
      .filter((a) => a.status === 'completed')
      .map((a) => a.opportunity_id)
  );
  const outcomes = appointments.filter((a) =>
    ['completed', 'no_show'].includes(a.status)
  );
  const contacted = cohort.filter((o) => o.first_contact_at);
  const onTime = contacted.filter(
    (o) =>
      Date.parse(o.first_contact_at!) >= Date.parse(o.created_at) &&
      Date.parse(o.first_contact_at!) - Date.parse(o.created_at) <= (data.settings?.leads.response_minutes??5)*60000
  );
  return {
    leads: cohort.length,
    connected: contacted.length,
    withinFiveMinutes: onTime.length,
    booked: new Set(
      appointments
        .filter((a) => a.status !== 'cancelled')
        .map((a) => a.opportunity_id)
    ).size,
    attended: attended.size,
    won: cohort.filter((o) => o.stage === 'won').length,
    shows: outcomes.filter((a) => a.status === 'completed').length,
    outcomes: outcomes.length,
  };
}
