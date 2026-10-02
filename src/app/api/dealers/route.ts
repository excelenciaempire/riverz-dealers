import { NextResponse } from 'next/server';
import { csrfGuard } from '@/lib/csrf';
import {
  dealerContext,
  dealerFailure,
  checkDb,
  readDealerData,
} from '@/lib/dealers/server';
import {
  object,
  uuid,
  vehicleInput,
  opportunityInput,
  appointmentInput,
  appointmentUpdate,
  activityInput,
  DealerError,
} from '@/lib/dealers/validation';
export async function GET(req: Request) {
  try {
    const ctx = await dealerContext();
    const raw = new URL(req.url).searchParams.get('contact');
    return NextResponse.json(
      await readDealerData(
        ctx.db,
        ctx.workspaceId,
        ctx.userId,
        raw ? uuid(raw) : undefined
      ),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return dealerFailure(e);
  }
}
export async function POST(req: Request) {
  const blocked = await csrfGuard(req);
  if (blocked) return blocked;
  try {
    const ctx = await dealerContext();
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      throw new DealerError('invalid');
    }
    const b = object(parsed),
      id = b.id ? uuid(b.id) : null;
    let savedId: string | null = id;
    if (b.entity === 'vehicle') {
      const data = vehicleInput(b.data);
      const q = id
        ? ctx.db
            .from('dealer_vehicles')
            .update(data)
            .eq('workspace_id', ctx.workspaceId)
            .eq('id', id)
        : ctx.db
            .from('dealer_vehicles')
            .insert({ ...data, workspace_id: ctx.workspaceId });
      const result = await q.select('id').single();
      checkDb(result.error);
      savedId = result.data?.id ?? null;
    } else if (b.entity === 'opportunity') {
      const data = opportunityInput(b.data);
      const result = await ctx.db.rpc('dealer_save_opportunity', {
        p_workspace: ctx.workspaceId,
        p_id: id,
        p_data: data,
      });
      checkDb(result.error);
      savedId = result.data;
    } else if (b.entity === 'appointment') {
      const q = id
        ? ctx.db
            .from('dealer_appointments')
            .update(appointmentUpdate(b.data))
            .eq('workspace_id', ctx.workspaceId)
            .eq('id', id)
        : ctx.db.from('dealer_appointments').insert({
            ...appointmentInput(b.data),
            workspace_id: ctx.workspaceId,
            seller_id: ctx.userId,
          });
      const result = await q.select('id').single();
      checkDb(result.error);
      savedId = result.data?.id ?? null;
    } else if (b.entity === 'activity') {
      if (id) throw new DealerError('invalid');
      const d = activityInput(b.data);
      const result = await ctx.db.rpc('dealer_log_activity', {
        p_workspace: ctx.workspaceId,
        p_opportunity: d.opportunity_id,
        p_kind: d.kind,
        p_note: d.note,
        p_next_at: d.next_follow_up_at,
        p_next_note: d.follow_up_note,
      });
      checkDb(result.error);
      savedId = result.data;
    } else throw new DealerError('invalid');
    return NextResponse.json({ id: savedId }, { status: id ? 200 : 201 });
  } catch (e) {
    return dealerFailure(e);
  }
}
