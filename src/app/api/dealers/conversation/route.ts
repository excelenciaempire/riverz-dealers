import { NextResponse } from 'next/server';
import { dealerContext, dealerFailure, checkDb } from '@/lib/dealers/server';
import { uuid, DealerError } from '@/lib/dealers/validation';
export async function GET(req: Request) {
  try {
    const ctx = await dealerContext(),
      contactId = uuid(new URL(req.url).searchParams.get('contact'));
    const result = await ctx.db
      .from('conversations')
      .select('id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    checkDb(result.error);
    if (!result.data) throw new DealerError('no_conversation', 404);
    return NextResponse.json(result.data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return dealerFailure(e);
  }
}
