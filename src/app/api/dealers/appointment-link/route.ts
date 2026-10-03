import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { csrfGuard } from '@/lib/csrf';
import { dealerContext, dealerFailure, checkDb } from '@/lib/dealers/server';
import { readDealerSettings } from '@/lib/dealers/settings-server';
import { dealerLinkHash } from '@/lib/dealers/appointment-links';
import { DealerError, object, uuid } from '@/lib/dealers/validation';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { publicBaseUrl } from '@/lib/base-url';
export async function POST(req: Request) {
  const blocked = await csrfGuard(req);
  if (blocked) return blocked;
  try {
    const c = await dealerContext(),
      b = object(await req.json()),
      id = uuid(b.appointment_id),
      { settings } = await readDealerSettings(c.db, c.workspaceId);
    if (!settings.appointments.self_service)
      throw new DealerError('disabled', 409);
    const r = await c.db
      .from('dealer_appointments')
      .select('starts_at,status')
      .eq('workspace_id', c.workspaceId)
      .eq('id', id)
      .maybeSingle();
    checkDb(r.error);
    if (
      !r.data ||
      !['requested', 'confirmed'].includes(r.data.status) ||
      Date.parse(r.data.starts_at) <= Date.now()
    )
      throw new DealerError('closed', 409);
    const token = randomBytes(32).toString('hex'),
      expires = new Date(
        Math.min(
          Date.parse(r.data.starts_at),
          Date.now() + settings.appointments.link_days * 86400000
        )
      ).toISOString();
    checkDb(
      (
        await supabaseAdmin()
          .from('dealer_appointment_links')
          .insert({
            token_hash: dealerLinkHash(token),
            workspace_id: c.workspaceId,
            appointment_id: id,
            expires_at: expires,
            schedule_revision: r.data.starts_at,
          })
      ).error
    );
    return NextResponse.json(
      { url: `${publicBaseUrl()}/cita#${token}`, expires_at: expires },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e) {
    return dealerFailure(e);
  }
}
