import type { SupabaseClient } from '@supabase/supabase-js';
import type { SendTemplateStepConfig } from '@/types';
import {
  selectTemplateVariant,
  type TemplateVariant,
} from './template-ab-test';

const RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;
const ORDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Existing exposures are the source of truth after traffic weights change. */
export async function assignedTemplateVariant(
  db: SupabaseClient,
  config: SendTemplateStepConfig,
  input: {
    workspaceId: string;
    automationId: string;
    stepId: string;
    contactId: string;
  }
): Promise<TemplateVariant | null> {
  const experiment = config.ab_test;
  if (!experiment) return null;
  const { data } = await db
    .from('automation_template_exposures')
    .select('variant_id')
    .eq('workspace_id', input.workspaceId)
    .eq('automation_id', input.automationId)
    .eq('automation_step_id', input.stepId)
    .eq('contact_id', input.contactId)
    .eq('experiment_id', experiment.id)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const existing = experiment.variants.find(
    (variant) => variant.id === data?.variant_id
  );
  return (
    existing ?? selectTemplateVariant(config, input.contactId, input.stepId)
  );
}

export async function recordExperimentExposure(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    automationId: string;
    stepId: string;
    logId?: string | null;
    contactId: string;
    experimentId: string;
    variantId: 'a' | 'b';
    templateName: string;
    whatsappMessageId: string;
  }
) {
  await db.from('automation_template_exposures').insert({
    workspace_id: input.workspaceId,
    automation_id: input.automationId,
    automation_step_id: input.stepId,
    automation_log_id: input.logId ?? null,
    contact_id: input.contactId,
    experiment_id: input.experimentId,
    variant_id: input.variantId,
    template_name: input.templateName,
    whatsapp_message_id: input.whatsappMessageId,
  });
}

/** Credits one inbound message to only the latest eligible experiment exposure. */
export async function attributeExperimentResponse(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    contactId: string;
    messageId: string;
    receivedAt: string;
  }
) {
  const since = new Date(
    new Date(input.receivedAt).getTime() - RESPONSE_WINDOW_MS
  ).toISOString();
  const { data } = await db
    .from('automation_template_exposures')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .is('response_at', null)
    .gte('sent_at', since)
    .lt('sent_at', input.receivedAt)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data)
    await db
      .from('automation_template_exposures')
      .update({
        response_at: input.receivedAt,
        response_message_id: input.messageId,
      })
      .eq('id', data.id)
      .is('response_at', null);
}

/** Credits one Shopify order to only the latest eligible experiment exposure. */
export async function attributeExperimentOrder(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    contactId: string;
    orderId: string;
    total: number | null;
    currency: string | null;
    orderedAt: string;
  }
) {
  const since = new Date(
    new Date(input.orderedAt).getTime() - ORDER_WINDOW_MS
  ).toISOString();
  const { data } = await db
    .from('automation_template_exposures')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('contact_id', input.contactId)
    .is('order_id', null)
    .gte('sent_at', since)
    .lt('sent_at', input.orderedAt)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data)
    await db
      .from('automation_template_exposures')
      .update({
        order_id: input.orderId,
        order_total: input.total,
        order_currency: input.currency,
        order_at: input.orderedAt,
      })
      .eq('id', data.id)
      .is('order_id', null);
}
