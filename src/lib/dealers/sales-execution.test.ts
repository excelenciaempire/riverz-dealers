import { describe, it, expect } from 'vitest';
import { demoData } from './demo';
import { salesActions, salesMetrics } from './sales-execution';
import { activityInput, appointmentUpdate } from './validation';
describe('dealer daily execution', () => {
  it('prioritizes fresh buyers and excludes closed, paused and opted-out buyers', () => {
    const d = demoData();
    d.appointments = [];
    const o = d.opportunities[0];
    o.stage = 'inquiry';
    o.follow_up_paused = false;
    expect(salesActions(d)[0]).toMatchObject({
      reason: 'new_lead',
      opportunity: { id: o.id },
    });
    o.follow_up_paused = true;
    expect(salesActions(d).some((a) => a.opportunity.id === o.id)).toBe(false);
    o.follow_up_paused = false;
    d.contacts.find((c) => c.id === o.contact_id)!.opted_out = true;
    expect(salesActions(d).some((a) => a.opportunity.id === o.id)).toBe(false);
  });
  it('recovers missed visits until actual contact or a new appointment supersedes them', () => {
    const d = demoData(),
      a = d.appointments[0],
      o = d.opportunities.find((o) => o.id === a.opportunity_id)!;
    d.appointments = [a];
    o.follow_up_paused = false;
    a.status = 'no_show';
    a.starts_at = new Date(Date.now() - 7200000).toISOString();
    a.ends_at = new Date(Date.now() - 3600000).toISOString();
    expect(salesActions(d).find((x) => x.opportunity.id === o.id)?.reason).toBe(
      'recover_no_show'
    );
    o.last_contact_at = new Date().toISOString();
    expect(
      salesActions(d).find((x) => x.opportunity.id === o.id)?.reason
    ).not.toBe('recover_no_show');
  });
  it('keeps funnel denominators in the same cohort and unanswered calls out of connected calls', () => {
    const d = demoData();
    d.opportunities[0].first_contact_at = null;
    const m = salesMetrics(d);
    expect(m.leads).toBe(d.opportunities.length);
    expect(m.connected).toBe(0);
    d.opportunities[0].first_contact_at = d.opportunities[0].created_at;
    expect(salesMetrics(d).withinFiveMinutes).toBe(1);
    d.opportunities[0].created_at = new Date(
      Date.now() - 31 * 86400000
    ).toISOString();
    expect(salesMetrics(d).connected).toBe(0);
  });
  it('requires a concrete next action for future follow-up and validates preparation booleans', () => {
    const d = demoData(),
      input = {
        opportunity_id: d.opportunities[0].id,
        kind: 'call_no_answer',
        next_follow_up_at: new Date(Date.now() + 3600000).toISOString(),
      };
    expect(() => activityInput(input)).toThrow();
    expect(
      activityInput({ ...input, follow_up_note: 'Send vehicle video' }).kind
    ).toBe('call_no_answer');
    expect(
      appointmentUpdate({ customer_confirmed: true, workspace_id: 'attacker' })
    ).toEqual({ customer_confirmed: true });
    expect(() => appointmentUpdate({ directions_sent: 'yes' })).toThrow();
  });
});
