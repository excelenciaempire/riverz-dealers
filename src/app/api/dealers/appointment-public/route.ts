import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { dealerFailure, checkDb } from '@/lib/dealers/server';
import {
  dealerAvailableSlots,
  dealerLinkHash,
  resolveDealerAppointment,
} from '@/lib/dealers/appointment-links';
import { assertDealerSlot } from '@/lib/dealers/settings';
import { DealerError, object, instant } from '@/lib/dealers/validation';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin)
      throw new DealerError('unauthorized', 403);
    const raw = await req.text();
    if (raw.length > 3000) throw new DealerError('invalid');
    const b = object(JSON.parse(raw));
    if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token))
      throw new DealerError('link', 404);
    const rate = checkRateLimit(`dealer-link:${dealerLinkHash(b.token)}`, {
      limit: 60,
      windowMs: 60000,
    });
    if (!rate.success) return rateLimitResponse(rate);
    const db = supabaseAdmin(),
      context = await resolveDealerAppointment(db, b.token);
    if (b.action === 'view') {
      const { ap, settings, vehicle } = context;
      return NextResponse.json(
        {
          starts_at: ap.starts_at,
          ends_at: ap.ends_at,
          status: ap.status,
          customer_confirmed: ap.customer_confirmed,
          location: ap.location,
          kind: ap.kind,
          timezone: settings.business.timezone,
          business: settings.business.name,
          seller: settings.business.seller_name,
          maps_url: settings.business.maps_url,
          video_url: settings.business.video_url,
          vehicle: {
            title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            photo: vehicle.photos?.[0] ?? null,
          },
          allow_reschedule: settings.appointments.allow_reschedule,
          slots: await dealerAvailableSlots(db, context),
        },
        {
          headers: {
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
        }
      );
    }
    if (!['confirm', 'cancel', 'reschedule'].includes(String(b.action)))
      throw new DealerError('invalid');
    let starts: string | null = null,
      ends: string | null = null;
    if (b.action === 'reschedule') {
      starts = instant(b.starts_at);
      ends = new Date(
        Date.parse(starts) +
          context.settings.appointments.duration_minutes * 60000
      ).toISOString();
      assertDealerSlot(context.settings, starts, ends);
    }
    const r = await db.rpc('dealer_appointment_action', {
      p_hash: dealerLinkHash(b.token),
      p_action: b.action,
      p_starts: starts,
      p_ends: ends,
    });
    checkDb(r.error);
    return NextResponse.json(
      {
        ok: true,
        status:
          b.action === 'cancel'
            ? 'cancelled'
            : b.action === 'reschedule'
              ? context.settings.appointments.require_seller_confirmation
                ? 'requested'
                : 'confirmed'
              : context.ap.status,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return dealerFailure(
      e instanceof SyntaxError ? new DealerError('invalid') : e
    );
  }
}
