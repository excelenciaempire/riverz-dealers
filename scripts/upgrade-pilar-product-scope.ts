import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const workspace = '522a68ae-568d-4dd9-92e5-2c8f633f1761';
  const id = 'fb865aa4-f84a-405c-8fc1-88157e334a3c';
  const { data: automation, error } = await db
    .from('automations')
    .select('is_active,trigger_config')
    .eq('workspace_id', workspace)
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (error) throw error;
  if (automation.is_active || !automation.trigger_config.retention_ai_managed)
    throw new Error('Expected inactive AI reorder flow');
  const pending = await db
    .from('automation_pending_executions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace)
    .eq('automation_id', id)
    .in('status', ['pending', 'running']);
  if (pending.error || pending.count !== 0)
    throw new Error('Review running executions before migration');
  const result = await db
    .from('automation_steps')
    .select('id,step_config')
    .eq('automation_id', id)
    .eq('step_type', 'condition');
  if (result.error) throw result.error;
  const changed = result.data.filter(
    (s) =>
      s.step_config.subject === 'context_var' &&
      ['first_item', 'offer_units'].includes(s.step_config.operand)
  );
  if (!changed.length) {
    console.log('Product scope already upgraded');
    return;
  }
  if (changed.length !== 4)
    throw new Error('Unexpected draft structure; review changes');
  await mkdir('output/retention', { recursive: true });
  await writeFile(
    'output/retention/pilar-before-product-scope.json',
    JSON.stringify(changed, null, 2),
    'utf8'
  );
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ steps: changed.length, active: false }));
    return;
  }
  for (const s of changed) {
    const update = await db
      .from('automation_steps')
      .update({
        step_config: {
          ...s.step_config,
          operand:
            s.step_config.operand === 'first_item'
              ? 'retention_product'
              : 'retention_units',
        },
      })
      .eq('automation_id', id)
      .eq('id', s.id)
      .eq('step_config', JSON.stringify(s.step_config))
      .select('id');
    if (update.error) throw new Error(update.error.message);
    if (update.data?.length !== 1)
      throw new Error(
        'Draft changed during migration; left inactive for review'
      );
  }
  console.log(JSON.stringify({ upgraded: changed.length, active: false }));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
