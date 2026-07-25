import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { serverError } from '@/lib/api/errors';
import {
  searchAvailableNumbers,
  getRegulatoryRequirements,
  type PhoneNumberType,
} from '@/lib/voice/telnyx-numbers';

/**
 * GET /api/voice/numbers/search?workspace_id=&country=CO&type=local&area_code=
 * Available numbers to buy + the country's regulatory requirements (empty =
 * instant, no documents). Session-authenticated (workspace member).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  const country = url.searchParams.get('country');
  if (!workspaceId || !country) {
    return NextResponse.json({ error: 'workspace_id and country required' }, { status: 400 });
  }

  const { data: member } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const type = (url.searchParams.get('type') as PhoneNumberType) || 'local';
  const areaCode = url.searchParams.get('area_code') || undefined;

  try {
    const [numbers, requirements] = await Promise.all([
      searchAvailableNumbers({ country, type, areaCode, limit: 20 }),
      getRegulatoryRequirements({ country, type }).catch(() => []),
    ]);
    return NextResponse.json({
      numbers,
      requirements,
      // Documents needed before ordering? (gated country)
      requires_documents: requirements.some((r) => r.field_type === 'document'),
    });
  } catch (err) {
    return serverError(err, 'number search failed');
  }
}
