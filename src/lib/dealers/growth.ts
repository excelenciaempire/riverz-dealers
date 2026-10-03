import type { DealerData, Vehicle } from './types';
import { DEFAULT_DEALER_SETTINGS, type DealerSettings } from './settings';
export function dealerGrowthMetrics(
  data: DealerData,
  settings: DealerSettings = DEFAULT_DEALER_SETTINGS,
  now = Date.now()
) {
  const cohort = data.opportunities.filter(
      (o) =>
        Date.parse(o.created_at) >= now - settings.metrics.days * 86400000 &&
        Date.parse(o.created_at) <= now
    ),
    ids = new Set(cohort.map((o) => o.id));
  const visits = data.appointments.filter((a) => ids.has(a.opportunity_id));
  const rate = (a: number, b: number) =>
    b ? Math.round((a / b) * 1000) / 10 : null;
  const summarize = (buyers: typeof cohort) => {
    const selected = new Set(buyers.map((o) => o.id)),
      apps = visits.filter((a) => selected.has(a.opportunity_id)),
      outcomes = apps.filter((a) =>
        ['completed', 'no_show'].includes(a.status)
      );
    const responses = buyers
      .map((o) => o.first_response_at ?? o.first_contact_at)
      .flatMap((at, i) =>
        at && Date.parse(at) >= Date.parse(buyers[i].created_at)
          ? [(Date.parse(at) - Date.parse(buyers[i].created_at)) / 60000]
          : []
      )
      .sort((a, b) => a - b);
    const connected = buyers.filter((o) => o.first_contact_at).length,
      responded = responses.length,
      booked = new Set(
        apps
          .filter((a) => a.status !== 'cancelled')
          .map((a) => a.opportunity_id)
      ).size,
      shows = outcomes.filter((a) => a.status === 'completed').length,
      won = buyers.filter((o) => o.stage === 'won').length;
    const median = responses.length
      ? responses.length % 2
        ? responses[Math.floor(responses.length / 2)]
        : (responses[responses.length / 2 - 1] +
            responses[responses.length / 2]) /
          2
      : null;
    return {
      leads: buyers.length,
      responded,
      connected,
      booked,
      shows,
      outcomes: outcomes.length,
      won,
      medianResponseMinutes: median,
      onTime: responses.filter((n) => n <= settings.leads.response_minutes)
        .length,
      contactRate: rate(connected, buyers.length),
      appointmentRate: rate(booked, buyers.length),
      showRate: rate(shows, outcomes.length),
      closeRate: rate(won, buyers.length),
    };
  };
  const sources = [...new Set(cohort.map((o) => o.lead_source || 'direct'))]
    .map((source) => ({
      source,
      ...summarize(
        cohort.filter((o) => (o.lead_source || 'direct') === source)
      ),
    }))
    .sort((a, b) => b.leads - a.leads);
  const losses = [
    ...new Set(
      cohort
        .filter((o) => o.stage === 'lost')
        .map((o) => o.lost_reason || 'other')
    ),
  ]
    .map((reason) => ({
      reason,
      count: cohort.filter(
        (o) => o.stage === 'lost' && (o.lost_reason || 'other') === reason
      ).length,
    }))
    .sort((a, b) => b.count - a.count);
  const reached = (stage: string) =>
    new Set([
      ...(data.stage_history ?? [])
        .filter((h) => ids.has(h.opportunity_id) && h.to_stage === stage)
        .map((h) => h.opportunity_id),
      ...cohort.filter((o) => o.stage === stage).map((o) => o.id),
    ]).size;
  return {
    ...summarize(cohort),
    sources,
    losses,
    stages: [
      'inquiry',
      'qualified',
      'appointment',
      'visit',
      'negotiation',
      'won',
      'lost',
    ].map((stage) => ({ stage, count: reached(stage) })),
    days: settings.metrics.days,
  };
}
/** Explicit model/make preference + confirmed price/currency; no guessed purchasing intent. */
export function dealerInventoryMatches(
  data: DealerData,
  settings: DealerSettings = DEFAULT_DEALER_SETTINGS,
  now = Date.now()
) {
  if (!settings.inventory.match_enabled) return [];
  const fresh = (v: Vehicle) =>
    v.status === 'available' &&
    v.source_checked_at &&
    Date.parse(v.source_checked_at) >=
      now - settings.inventory.freshness_hours * 3600000 &&
    v.source_changed_at &&
    Date.parse(v.source_changed_at) >= now - 7 * 86400000;
  const candidates = data.vehicles.filter(fresh),
    lower = (s: string) =>
      s.toLocaleLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ');
  return data.opportunities
    .filter(
      (o) =>
        !['won', 'lost'].includes(o.stage) &&
        !o.follow_up_paused &&
        !data.contacts.find((c) => c.id === o.contact_id)?.opted_out
    )
    .flatMap((o) => {
      const interested = data.vehicles.filter((v) =>
        data.interests.some(
          (i) => i.opportunity_id === o.id && i.vehicle_id === v.id
        )
      );
      const matches = candidates.filter(
        (v) =>
          v.price !== null &&
          o.budget !== null &&
          v.currency === o.currency &&
          v.price <= o.budget &&
          (interested.some(
            (i) =>
              i.make === v.make &&
              i.model.split(' ')[0] === v.model.split(' ')[0]
          ) ||
            lower(o.preferences)
              .split(/\s+/)
              .some(
                (p) =>
                  p.length >= 4 &&
                  [lower(v.make), ...lower(v.model).split(/\s+/)].includes(p)
              ))
      );
      return matches.length
        ? [{ opportunity: o, vehicles: matches.slice(0, 3) }]
        : [];
    })
    .slice(0, 30);
}
