import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildRetentionPlan } from '../src/lib/automations/retention-plan';

// Only repair the known, unsubmitted draft. Never edit an approved template.
async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const workspace = '522a68ae-568d-4dd9-92e5-2c8f633f1761';
  for (const suffix of ['ultimo_recordatorio', 'experiencia']) {
    const name = `pilar_postventa_v1_${suffix}`;
    const { data: row, error } = await db
      .from('message_templates')
      .select('*')
      .eq('workspace_id', workspace)
      .eq('name', name)
      .eq('language', 'es')
      .single();
    if (error) throw error;
    const plan = buildRetentionPlan({
      locale: 'es',
      prefix: 'pilar_postventa_v1',
      product: 'Serum Pilar',
      offers: [{ units: 1, day: 22, label: '1 unidad' }],
      tags: { enrolled: '', permission: '', paused: '', help: '' },
    });
    const desired = plan.templates.find((t) => t.nombre === name)!;
    const buttonLabels = (buttons: Array<{ type: string; text: string }>) =>
      buttons.map((b) => `${b.type}:${b.text}`).join('|');
    if (
      row.body_text === desired.bodyText &&
      buttonLabels(row.buttons ?? []) === buttonLabels(desired.buttons ?? [])
    ) {
      console.log(`${name}: already repaired`);
      continue;
    }
    if (row.status !== 'Draft' || row.meta_template_id)
      throw new Error('Expected an unsubmitted draft');
    const expected =
      suffix === 'ultimo_recordatorio'
        ? 'puedes elegir que te recordemos más adelante'
        : 'prefieres que te recordemos más adelante';
    if (!row.body_text.includes(expected))
      throw new Error('Draft was edited; review before repair');
    await mkdir('output/retention', { recursive: true });
    await writeFile(
      `output/retention/pilar-${suffix}-before-repair.json`,
      JSON.stringify(row, null, 2),
      'utf8'
    );
    if (!process.argv.includes('--apply')) {
      console.log(
        JSON.stringify({
          name,
          body: desired.bodyText,
          buttons: desired.buttons,
        })
      );
      continue;
    }
    const result = await db
      .from('message_templates')
      .update({ body_text: desired.bodyText, buttons: desired.buttons })
      .eq('workspace_id', workspace)
      .eq('id', row.id)
      .eq('status', 'Draft')
      .eq('updated_at', row.updated_at)
      .select('id');
    if (result.error || result.data?.length !== 1)
      throw new Error('Draft changed during repair');
    console.log(JSON.stringify({ name, repaired: true, submitted: false }));
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
