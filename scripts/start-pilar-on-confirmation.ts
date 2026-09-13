import { createClient } from '@supabase/supabase-js';
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '../src/lib/automations/steps-tree';
import { buildRetentionPlan } from '../src/lib/automations/retention-plan';
import { crearPlantilla } from '../src/lib/templates/create';
import { activationIssues } from '../src/lib/automations/activation';
import { writeFile, mkdir } from 'node:fs/promises';
async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const workspace = '522a68ae-568d-4dd9-92e5-2c8f633f1761',
    id = 'fb865aa4-f84a-405c-8fc1-88157e334a3c';
  const r = await db
    .from('automations')
    .select('*')
    .eq('workspace_id', workspace)
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (r.error) throw r.error;
  if (r.data.trigger_config.retention_enrollment === 'confirmed_order') {
    console.log('Already migrated');
    return;
  }
  const pending = await db
    .from('automation_pending_executions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace)
    .eq('automation_id', id)
    .in('status', ['pending', 'running']);
  if (pending.error || pending.count !== 0)
    throw Error('Review existing waits before changing the starting event');
  const old = await loadStepsTree(id);
  const pause = '4bc30453-5c39-4374-b572-e4546a17d3bb';
  const plan = buildRetentionPlan({
    locale: 'es',
    prefix: 'pilar_postventa_v1',
    product: 'Serum Pilar',
    offers: [{ units: 1, day: 22, label: '1 unidad' }],
    tags: { enrolled: '', permission: '', paused: pause, help: '' },
  });
  const first = plan.templates.find((t) =>
    t.nombre.endsWith('_pedido_confirmado')
  )!;
  const transform = (nodes: BuilderStepInput[]): BuilderStepInput[] =>
    nodes.flatMap((s) => {
      if (
        s.step_type === 'condition' &&
        s.step_config.subject === 'tag_presence' &&
        s.step_config.operand === r.data.trigger_config.retention_permission_tag
      )
        return transform(s.branches?.yes ?? []);
      return [
        {
          ...s,
          step_config:
            s.step_type === 'send_template' &&
            s.step_config.template_name === 'pilar_postventa_v1_entrega'
              ? { ...s.step_config, template_name: first.nombre }
              : s.step_config,
          ...(s.branches
            ? {
                branches: {
                  yes: transform(s.branches.yes ?? []),
                  no: transform(s.branches.no ?? []),
                },
              }
            : {}),
        },
      ];
    });
  const steps = transform(old);
  const config = {
    ...r.data.trigger_config,
    retention_enrollment: 'confirmed_order',
    retention_pause_tag: pause,
  };
  delete config.retention_permission_tag;
  const issues = activationIssues({
    triggerType: 'shopify_order_confirmed',
    triggerConfig: config,
    steps,
  });
  if (issues.length) throw Error(JSON.stringify(issues));
  if (!process.argv.includes('--apply')) {
    console.log({ trigger: 'shopify_order_confirmed', template: first.nombre });
    return;
  }
  await mkdir('output/retention', { recursive: true });
  await writeFile(
    'output/retention/pilar-before-confirmation-start.json',
    JSON.stringify({ automation: r.data, steps: old }, null, 2),
    'utf8'
  );
  const t = await crearPlantilla(db, {
    ...first,
    workspaceId: workspace,
    userId: null,
    enviarAMeta: true,
  });
  if (!t.ok) throw Error(JSON.stringify(t));
  const stopped = await db
    .from('automations')
    .update({ is_active: false, activation_state: 'draft' })
    .eq('workspace_id', workspace)
    .eq('id', id)
    .eq('updated_at', r.data.updated_at)
    .select('id');
  if (stopped.error || stopped.data?.length !== 1)
    throw Error('Automation changed during migration');
  const changed = await replaceSteps(id, steps);
  if (changed) throw Error(changed);
  const updated = await db
    .from('automations')
    .update({
      trigger_type: 'shopify_order_confirmed',
      trigger_config: config,
      description:
        'Seguimiento desde el pago acreditado o la confirmación del pedido contra entrega. Las respuestas continúan con la IA.',
    })
    .eq('workspace_id', workspace)
    .eq('id', id)
    .eq('is_active', false);
  if (updated.error) throw updated.error;
  console.log({
    migrated: true,
    active: false,
    template: t.name,
    meta: t.estadoMeta,
  });
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
