import type { SupabaseClient } from '@supabase/supabase-js';
import { RIVERZOFICIAL_WORKSPACE } from './riverzoficial-template-context';
import {
  riverzoficialProductTemplateKey,
  riverzoficialProductTemplateName,
} from './riverzoficial-template-versions';

/**
 * Cambia los pasos de Riverz Oficial apenas Meta aprueba una nueva versión.
 * La versión anterior sigue activa durante la revisión, así que una aprobación
 * lenta nunca detiene confirmaciones, carritos ni avisos de despacho.
 */
export async function promoteApprovedRiverzoficialTemplate(
  db: SupabaseClient,
  workspaceId: string,
  templateName: string,
  language = 'es',
): Promise<number> {
  if (workspaceId !== RIVERZOFICIAL_WORKSPACE) return 0;
  const key = riverzoficialProductTemplateKey(templateName);
  if (!key || riverzoficialProductTemplateName(key) !== templateName) return 0;

  const { data: template, error: templateError } = await db
    .from('message_templates')
    .select('variable_fields,status')
    .eq('workspace_id', workspaceId)
    .eq('name', templateName)
    .eq('language', language)
    .maybeSingle();
  if (templateError) throw templateError;
  if (String(template?.status ?? '').toLowerCase() !== 'approved') return 0;

  const { data: automations, error: automationError } = await db
    .from('automations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null);
  if (automationError) throw automationError;
  const automationIds = (automations ?? []).map((row) => row.id);
  if (!automationIds.length) return 0;

  const { data: steps, error: stepError } = await db
    .from('automation_steps')
    .select('id,automation_id,step_config')
    .in('automation_id', automationIds)
    .eq('step_type', 'send_template');
  if (stepError) throw stepError;

  const fields = (template?.variable_fields ?? {}) as Record<string, unknown>;
  const variables = Object.fromEntries(
    Object.entries(fields)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([position, field]) => [position, `{{vars.${String(field)}}}`]),
  );
  let promoted = 0;
  for (const step of steps ?? []) {
    const config = (step.step_config ?? {}) as Record<string, unknown>;
    const previousName = String(config.template_name ?? '');
    if (
      riverzoficialProductTemplateKey(previousName) !== key ||
      previousName === templateName ||
      String(config.language ?? 'es') !== language
    ) {
      continue;
    }
    const { error } = await db
      .from('automation_steps')
      .update({
        step_config: { ...config, template_name: templateName, variables },
      })
      .eq('id', step.id)
      .eq('automation_id', step.automation_id);
    if (error) throw error;
    promoted += 1;
  }
  return promoted;
}
