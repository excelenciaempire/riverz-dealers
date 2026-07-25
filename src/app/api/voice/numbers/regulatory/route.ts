import { NextResponse } from 'next/server';
import type { PhoneNumberType } from '@/lib/voice/telnyx-numbers';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import {
  isVoiceAdmin,
  isVoiceMember,
  readVoiceConfig,
  writeVoiceConfig,
} from '@/lib/voice/voice-connection-store';
import {
  createRequirementGroup,
  submitRequirementGroup,
  getRequirementGroup,
} from '@/lib/voice/telnyx-numbers';

/**
 * Regulatory requirement group for a regulated country.
 *   POST → create the group from filled requirements + submit for approval;
 *          persist the group id + status on the voice config.
 *   GET  → refresh the stored group's approval status from Telnyx.
 * The number can only be ordered once the group is `approved`.
 * POST is admin-only; GET is any member (status read).
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    country?: string;
    type?: PhoneNumberType;
    requirements?: { requirement_id: string; field_value: string }[];
  } | null;
  if (!body?.workspace_id || !body.country || !body.requirements?.length) {
    return NextResponse.json(
      { error: 'workspace_id, country and requirements required' },
      { status: 400 },
    );
  }
  if (!(await isVoiceAdmin(user.id, body.workspace_id)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const group = await createRequirementGroup({
      country: body.country,
      type: body.type ?? 'local',
      requirements: body.requirements,
      customerReference: body.workspace_id,
    });
    const submitted = await submitRequirementGroup(group.id);

    const { id, config } = await readVoiceConfig(body.workspace_id);
    await writeVoiceConfig(
      body.workspace_id,
      id,
      { ...config, regulatory_group_id: submitted.id, regulatory_status: submitted.status },
      config.phone_number ? 'connected' : 'pending',
    );
    return NextResponse.json({ requirement_group_id: submitted.id, status: submitted.status });
  } catch (err) {
    return serverError(err, 'requirement group failed');
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await isVoiceMember(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id, config } = await readVoiceConfig(workspaceId);
  if (!config.regulatory_group_id) {
    return NextResponse.json({ requirement_group_id: null, status: null });
  }
  try {
    const group = await getRequirementGroup(config.regulatory_group_id);
    // Cache the fresh status back onto the config.
    if (group.status !== config.regulatory_status) {
      await writeVoiceConfig(
        workspaceId,
        id,
        { ...config, regulatory_status: group.status },
        config.phone_number ? 'connected' : 'pending',
      );
    }
    return NextResponse.json({ requirement_group_id: group.id, status: group.status });
  } catch (err) {
    return serverError(err, 'requirement group status failed');
  }
}
