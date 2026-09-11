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
import { persistCallResult } from '@/lib/voice/result';

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
  { params }: { params: Promise<{ id: string }> }
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
      { status: 401 }
    );

  const target = await requireMember(id, user.id);
  if (!target)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 }
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
      { status: 400 }
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
        { status: 400 }
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
        { status: 409 }
      );
    }
    if (fail.code === 'voice_note_invalid') {
      return NextResponse.json({ error: translate(locale, 'voiceNotes.invalidText') }, { status: 400 });
    }
    if (fail.code === 'voice_agent_invalid') {
      return NextResponse.json(
        { error: translate(locale, 'errAi.voiceAgentInvalid') },
        { status: 400 }
      );
    }
    return serverError(fail.error);
  }

  return NextResponse.json({ ok: true, agent: outcome.agent });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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
      { status: 401 }
    );

  const target = await requireMember(id, user.id);
  if (!target)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 }
    );

  // Soft-delete via migration 059's `deleted_at` column. Partial index
  // `idx_ai_agents_workspace_active` ignores tombstones so the runner
  // stops picking this agent immediately, while ai_replies history is
  // preserved for analytics.
  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  const [{ data: queuedRows }, { data: stepRows }] = await Promise.all([
    admin
      .from('voice_calls')
      .select('id')
      .eq('workspace_id', target.workspace_id)
      .eq('agent_id', id)
      .eq('status', 'queued'),
    admin
      .from('automation_steps')
      .select(
        'id, automation_id, step_config, automations!inner(workspace_id)'
      )
      .eq('step_type', 'voice_call')
      .eq('automations.workspace_id', target.workspace_id),
  ]);
  const { error } = await admin
    .from('ai_agents')
    .update({ deleted_at: now })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return serverError(error);

  // Voice profiles may be linked from chat assistants and queued work. The
  // tombstone keeps past calls intact, while these active links are cleared so
  // nothing can silently keep trying to use a deleted profile.
  const affectedSteps = (
    (stepRows ?? []) as {
      id: string;
      automation_id: string;
      step_config: Record<string, unknown> | null;
    }[]
  ).filter((step) => step.step_config?.agent_id === id);
  const affectedAutomationIds = [
    ...new Set(affectedSteps.map((step) => step.automation_id)),
  ];
  const cleanup = await Promise.all([
    admin
      .from('ai_agents')
      .update({ voice_agent_id: null, voice_ai_decides: false })
      .eq('workspace_id', target.workspace_id)
      .eq('voice_agent_id', id)
      .is('deleted_at', null),
    ...affectedSteps.map((step) =>
      admin
        .from('automation_steps')
        .update({ step_config: { ...(step.step_config ?? {}), agent_id: '' } })
        .eq('id', step.id)
    ),
    ...(affectedAutomationIds.length
      ? [
          admin
            .from('automations')
            .update({ is_active: false, activation_state: 'draft' })
            .eq('workspace_id', target.workspace_id)
            .in('id', affectedAutomationIds),
        ]
      : []),
    admin
      .from('voice_campaigns')
      .update({ status: 'paused', updated_at: now })
      .eq('workspace_id', target.workspace_id)
      .eq('agent_id', id)
      .eq('status', 'running'),
  ]);
  if (cleanup.some((result) => result.error)) {
    console.error('[voice] agent cleanup incomplete', {
      agentId: id,
      errors: cleanup.map((result) => result.error).filter(Boolean),
    });
  }

  // Finish every queued row through the canonical result pipeline. Besides
  // canceling the call, this wakes an automation parked on that call instead
  // of leaving it frozen until the 24-hour safety timeout.
  await Promise.all(
    ((queuedRows ?? []) as { id: string }[]).map((call) =>
      persistCallResult({
        call_id: call.id,
        status: 'canceled',
        ended_at: now,
        error: 'agent_deleted',
      })
    )
  );
  return NextResponse.json({ ok: true });
}
