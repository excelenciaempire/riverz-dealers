import 'server-only';
import { createHash } from 'node:crypto';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readDealerSettings } from './settings-server';
import { checkDb } from './server';
import { DealerError } from './validation';
import { assertDealerSlot } from './settings';
export const dealerLinkHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export async function resolveDealerAppointment(
  db: SupabaseClient,
  token: string
) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new DealerError('link', 404);
  const l = await db
    .from('dealer_appointment_links')
    .select('*')
    .eq('token_hash', dealerLinkHash(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  checkDb(l.error);
  if (!l.data) throw new DealerError('link', 404);
  const link = l.data;
  const [a, config] = await Promise.all([
    db
      .from('dealer_appointments')
      .select('*')
      .eq('workspace_id', link.workspace_id)
      .eq('id', link.appointment_id)
      .maybeSingle(),
    readDealerSettings(db, link.workspace_id),
  ]);
  checkDb(a.error);
  const ap = a.data,
    settings = config.settings;
  if (
    !ap ||
    !settings.appointments.self_service ||
    !['requested', 'confirmed'].includes(ap.status) ||
    Date.parse(ap.starts_at) <= Date.now() ||
    Date.parse(ap.starts_at) !== Date.parse(link.schedule_revision)
  )
    throw new DealerError('link', 410);
  const [v, o] = await Promise.all([
    db
      .from('dealer_vehicles')
      .select('id,year,make,model,status,photos')
      .eq('workspace_id', link.workspace_id)
      .eq('id', ap.vehicle_id)
      .single(),
    db
      .from('dealer_opportunities')
      .select('stage,contact_id')
      .eq('workspace_id', link.workspace_id)
      .eq('id', ap.opportunity_id)
      .single(),
  ]);
  checkDb(v.error);
  checkDb(o.error);
  const c = await db
    .from('contacts')
    .select('opted_out')
    .eq('workspace_id', link.workspace_id)
    .eq('id', o.data!.contact_id)
    .single();
  checkDb(c.error);
  if (
    v.data?.status !== 'available' ||
    ['won', 'lost'].includes(o.data!.stage) ||
    c.data?.opted_out
  )
    throw new DealerError('link', 410);
  return { ap, settings, vehicle: v.data!, link };
}
export async function dealerAvailableSlots(
  db: SupabaseClient,
  context: Awaited<ReturnType<typeof resolveDealerAppointment>>
) {
  const { ap, settings, link } = context,
    s = settings.appointments,
    now = Date.now(),
    horizon = now + s.horizon_days * 86400000;
  if (!s.allow_reschedule) return [];
  const r = await db
    .from('dealer_appointments')
    .select('id,starts_at,ends_at')
    .eq('workspace_id', link.workspace_id)
    .in('status', ['requested', 'confirmed'])
    .or(`seller_id.eq.${ap.seller_id},vehicle_id.eq.${ap.vehicle_id}`)
    .gte('ends_at', new Date(now).toISOString())
    .lte('starts_at', new Date(horizon).toISOString())
    .limit(5001);
  checkDb(r.error);
  if ((r.data?.length ?? 0) > 5000) throw new DealerError('schedule', 503);
  const day0 = formatInTimeZone(now, settings.business.timezone, 'yyyy-MM-dd'),
    slots: string[] = [];
  for (let d = 0; d <= s.horizon_days && slots.length < 80; d++) {
    const date = new Date(`${day0}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + d);
    const day = date.toISOString().slice(0, 10);
    for (
      let minute = s.start_hour * 60;
      minute + s.duration_minutes <= s.end_hour * 60 && slots.length < 80;
      minute += s.duration_minutes
    ) {
      const start = fromZonedTime(
          `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
          settings.business.timezone
        ).getTime(),
        end = start + s.duration_minutes * 60000;
      try {
        assertDealerSlot(
          settings,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
          now
        );
      } catch {
        continue;
      }
      if (
        !r.data?.some(
          (other) =>
            other.id !== ap.id &&
            Date.parse(other.starts_at) < end &&
            Date.parse(other.ends_at) > start
        )
      )
        slots.push(new Date(start).toISOString());
    }
  }
  return slots;
}
