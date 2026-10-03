import { DealerError, object, uuid } from './validation';
import { isPublicHttpsUrl } from '@/lib/security/url-guard';

export interface DealerSettings {
  business: {
    name: string;
    seller_name: string;
    timezone: string;
    location: string;
    maps_url: string;
    video_url: string;
  };
  leads: {
    capture_enabled: boolean;
    webhook_enabled: boolean;
    default_seller_id: string | null;
    response_minutes: number;
    follow_up_hours: number;
    default_source: string;
  };
  inventory: {
    enabled: boolean;
    feed_url: string;
    format: 'json' | 'csv';
    interval_minutes: number;
    freshness_hours: number;
    retire_missing: boolean;
    minimum_units: number;
    allow_status_updates: boolean;
    match_enabled: boolean;
    mapping: Record<string, string>;
  };
  appointments: {
    self_service: boolean;
    allow_reschedule: boolean;
    duration_minutes: number;
    notice_hours: number;
    horizon_days: number;
    start_hour: number;
    end_hour: number;
    weekdays: number[];
    reminder_hours: number;
    link_days: number;
    require_seller_confirmation: boolean;
  };
  follow_up: {
    enabled: boolean;
    start_hour: number;
    end_hour: number;
    weekdays: number[];
    outcome_hours: number;
  };
  coach: {
    enabled: boolean;
    language: 'es' | 'en';
    tone: string;
    instructions: string;
    practice_objections: string[];
  };
  metrics: {
    days: number;
    target_contact_percent: number;
    target_show_percent: number;
    target_close_percent: number;
    lost_reasons: string[];
  };
  pipeline: { labels: Record<string, { es: string; en: string }> };
}
export const DEFAULT_DEALER_SETTINGS: DealerSettings = {
  business: {
    name: '',
    seller_name: '',
    timezone: 'America/New_York',
    location: '',
    maps_url: '',
    video_url: '',
  },
  leads: {
    capture_enabled: true,
    webhook_enabled: false,
    default_seller_id: null,
    response_minutes: 5,
    follow_up_hours: 24,
    default_source: 'direct',
  },
  inventory: {
    enabled: false,
    feed_url: '',
    format: 'json',
    interval_minutes: 60,
    freshness_hours: 24,
    retire_missing: false,
    minimum_units: 1,
    allow_status_updates: false,
    match_enabled: true,
    mapping: {},
  },
  appointments: {
    self_service: true,
    allow_reschedule: true,
    duration_minutes: 30,
    notice_hours: 2,
    horizon_days: 30,
    start_hour: 9,
    end_hour: 19,
    weekdays: [1, 2, 3, 4, 5, 6],
    reminder_hours: 24,
    link_days: 14,
    require_seller_confirmation: true,
  },
  follow_up: {
    enabled: true,
    start_hour: 9,
    end_hour: 19,
    weekdays: [1, 2, 3, 4, 5, 6],
    outcome_hours: 24,
  },
  coach: {
    enabled: true,
    language: 'es',
    tone: 'professional',
    instructions: '',
    practice_objections: [
      'price',
      'distance',
      'thinking',
      'trust',
      'financing',
    ],
  },
  metrics: {
    days: 30,
    target_contact_percent: 90,
    target_show_percent: 70,
    target_close_percent: 15,
    lost_reasons: [
      'price',
      'inventory',
      'timing',
      'financing',
      'competitor',
      'no_response',
      'other',
    ],
  },
  pipeline: { labels: {} },
};
const fields = [
  'stock_number',
  'vin',
  'make',
  'model',
  'year',
  'mileage',
  'mileage_unit',
  'price',
  'currency',
  'status',
  'photos',
  'notes',
] as const;
export function dealerSettings(input: unknown): DealerSettings {
  const raw = object(input);
  if (Object.keys(raw).some((k) => !Object.hasOwn(DEFAULT_DEALER_SETTINGS, k)))
    throw new DealerError('invalid');
  const result = structuredClone(DEFAULT_DEALER_SETTINGS);
  for (const section of Object.keys(result) as (keyof DealerSettings)[]) {
    const supplied = raw[section] == null ? {} : object(raw[section]);
    const target = result[section] as unknown as Record<string, unknown>;
    if (Object.keys(supplied).some((k) => !Object.hasOwn(target, k)))
      throw new DealerError('invalid');
    Object.assign(target, supplied);
  }
  const str = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max)
      throw new DealerError('invalid');
    return v.trim();
  };
  const num = (v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new DealerError('invalid');
  };
  const bool = (v: unknown) => {
    if (typeof v !== 'boolean') throw new DealerError('invalid');
  };
  for (const [section, values] of Object.entries(result))
    for (const [key, value] of Object.entries(values)) {
      const defaultValue = (
        DEFAULT_DEALER_SETTINGS[
          section as keyof DealerSettings
        ] as unknown as Record<string, unknown>
      )[key];
      if (typeof defaultValue === 'boolean') bool(value);
      if (typeof defaultValue === 'string')
        (values as unknown as Record<string, unknown>)[key] = str(
          value,
          key === 'instructions'
            ? 3000
            : key === 'feed_url' || key.endsWith('_url')
              ? 2048
              : 500
        );
    }
  try {
    new Intl.DateTimeFormat('en', { timeZone: result.business.timezone });
  } catch {
    throw new DealerError('invalid');
  }
  for (const value of [
    result.business.maps_url,
    result.business.video_url,
    result.inventory.feed_url,
  ])
    if (value && !isPublicHttpsUrl(value)) throw new DealerError('invalid');
  if (result.leads.default_seller_id !== null)
    uuid(result.leads.default_seller_id);
  num(result.leads.response_minutes, 1, 120);
  num(result.leads.follow_up_hours, 1, 720);
  if (!['json', 'csv'].includes(result.inventory.format))
    throw new DealerError('invalid');
  num(result.inventory.interval_minutes, 15, 1440);
  num(result.inventory.freshness_hours, 1, 168);
  num(result.inventory.minimum_units, 1, 5000);
  if (result.inventory.enabled && !result.inventory.feed_url)
    throw new DealerError('invalid');
  result.inventory.mapping = object(result.inventory.mapping) as Record<
    string,
    string
  >;
  for (const [key, value] of Object.entries(result.inventory.mapping))
    if (
      !fields.includes(key as (typeof fields)[number]) ||
      typeof value !== 'string' ||
      !/^[\w .-]{1,100}$/.test(value) ||
      ['__proto__', 'constructor', 'prototype'].includes(value)
    )
      throw new DealerError('invalid');
  num(result.appointments.duration_minutes, 15, 240);
  num(result.appointments.notice_hours, 0, 168);
  num(result.appointments.horizon_days, 1, 90);
  num(result.appointments.reminder_hours, 1, 72);
  num(result.appointments.link_days, 1, 90);
  num(result.follow_up.outcome_hours, 1, 72);
  for (const s of [result.appointments, result.follow_up]) {
    num(s.start_hour, 0, 23);
    num(s.end_hour, 1, 24);
    if (s.end_hour <= s.start_hour) throw new DealerError('invalid');
    if (
      !Array.isArray(s.weekdays) ||
      !s.weekdays.length ||
      s.weekdays.length > 7
    )
      throw new DealerError('invalid');
    s.weekdays = [...new Set(s.weekdays)];
    s.weekdays.forEach((d) => num(d, 0, 6));
  }
  if (!['es', 'en'].includes(result.coach.language))
    throw new DealerError('invalid');
  for (const list of [
    result.coach.practice_objections,
    result.metrics.lost_reasons,
  ])
    if (
      !Array.isArray(list) ||
      list.length > 20 ||
      list.some((v) => typeof v !== 'string' || !v.trim() || v.length > 120)
    )
      throw new DealerError('invalid');
  num(result.metrics.days, 7, 365);
  for (const v of [
    result.metrics.target_contact_percent,
    result.metrics.target_show_percent,
    result.metrics.target_close_percent,
  ])
    num(v, 0, 100);
  const labels = object(result.pipeline.labels);
  if (
    Object.keys(labels).some(
      (k) =>
        ![
          'inquiry',
          'qualified',
          'appointment',
          'visit',
          'negotiation',
          'won',
          'lost',
        ].includes(k)
    )
  )
    throw new DealerError('invalid');
  for (const value of Object.values(labels)) {
    const v = object(value);
    str(v.es, 40);
    str(v.en, 40);
    if (!v.es || !v.en) throw new DealerError('invalid');
  }
  return result;
}
export function dealerBusinessTime(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? '';
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      part('weekday')
    ),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  };
}
export function assertDealerSlot(
  settings: DealerSettings,
  starts: string,
  ends: string,
  now = Date.now()
) {
  const a = Date.parse(starts),
    b = Date.parse(ends),
    s = settings.appointments;
  const first = dealerBusinessTime(a, settings.business.timezone),
    last = dealerBusinessTime(b - 1, settings.business.timezone);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < now + s.notice_hours * 3600000 ||
    a > now + s.horizon_days * 86400000 ||
    b - a !== s.duration_minutes * 60000 ||
    !s.weekdays.includes(first.day) ||
    first.day !== last.day ||
    first.hour < s.start_hour ||
    last.hour >= s.end_hour
  )
    throw new DealerError('schedule', 409);
}
