import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { channelLabels } from '@/lib/ai/channel-conflict';
import { pickAgentPatch, updateAgent } from '@/lib/ai/agents/update';
import type { AiAgent } from '@/lib/ai/types';

async function requireMember(agentId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('id, workspace_id')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) return null;
  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as { workspace_id: string }).workspace_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) return null;
  return agent as { id: string; workspace_id: string };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 },
    );

  const target = await requireMember(id, user.id);
  if (!target)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 },
    );

  const body = (await request.json().catch(() => null)) as
    | (Partial<AiAgent> & {
        channels?: string[];
        product_ids?: string[];
        api_key?: string;
      })
    | null;
  if (!body)
    return NextResponse.json(
      { error: translate(locale, 'errAi.invalidJson') },
      { status: 400 },
    );

  // El cuerpo del guardado vive en `@/lib/ai/agents/update`: el Operator
  // guarda un agente por la misma puerta, con la misma validación de choque de
  // canal. Acá queda lo que es de HTTP — el idioma y el código de estado.
  const outcome = await updateAgent(supabaseAdmin(), {
    agentId: id,
    workspaceId: target.workspace_id,
    patch: pickAgentPatch(body),
    channels: Array.isArray(body.channels) ? body.channels : undefined,
    productIds: Array.isArray(body.product_ids) ? body.product_ids : undefined,
  });

  if (!outcome.ok) {
    const { fail } = outcome;
    if (fail.code === 'channels_required') {
      return NextResponse.json(
        { error: translate(locale, 'errAi.channelsRequired') },
        { status: 400 },
      );
    }
    if (fail.code === 'channel_conflict') {
      return NextResponse.json(
        {
          error: translate(locale, 'errAi.channelConflict', {
            agent: fail.agentName,
            channels: channelLabels(fail.channels, locale),
          }),
        },
        { status: 409 },
      );
    }
    return serverError(fail.error);
  }

  return NextResponse.json({ ok: true, agent: outcome.agent });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 },
    );

  const target = await requireMember(id, user.id);
  if (!target)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 },
    );

  // Soft-delete via migration 059's `deleted_at` column. Partial index
  // `idx_ai_agents_workspace_active` ignores tombstones so the runner
  // stops picking this agent immediately, while ai_replies history is
  // preserved for analytics.
  const { error } = await supabaseAdmin()
    .from('ai_agents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
