/** Run without --apply to preview. Updates only riverzoficial template bodies.
 * Keeps variables, buttons and categories. Pending versions get a replacement.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { riverzoficialCopy, RIVERZOFICIAL_WORKSPACE } from './riverzoficial-copy';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const signature = (text: string) => [...new Set(text.match(/\{\{\d+\}\}/g) ?? [])].sort().join(',');
async function main() {
  const { resolverWabaYToken } = await import('@/lib/templates/create');
  const { withAppsecretProof } = await import('@/lib/channels/meta-graph');
  const { data: rows, error } = await db.from('message_templates').select('*').eq('workspace_id', RIVERZOFICIAL_WORKSPACE);
  if (error) throw error;
  const apply = process.argv.includes('--apply');
  const { data: flows, error: flowError } = await db.from('automations').select('id').eq('workspace_id', RIVERZOFICIAL_WORKSPACE).is('deleted_at', null);
  if (flowError) throw flowError;
  mkdirSync('tmp', { recursive: true });
  const run = Date.now();
  writeFileSync(`tmp/riverzoficial-copy-backup-${run}.json`, JSON.stringify(rows, null, 2));
  const results: object[] = [];
  for (const row of rows ?? []) {
    if (row.name.endsWith('_human_v1')) continue;
    const body = riverzoficialCopy[`${row.name}:${row.language}`];
    if (!body) throw new Error(`Missing reviewed copy: ${row.name}:${row.language}`);
    if (signature(body) !== signature(row.body_text)) throw new Error(`Variable mismatch: ${row.name}`);
    if (body.length > 1024 || /\uFFFD/.test(body)) throw new Error(`Invalid copy: ${row.name}`);
  }
  for (const row of rows ?? []) {
    if (row.name.endsWith('_human_v1')) continue;
    const body = riverzoficialCopy[`${row.name}:${row.language}`];
    const result = { name: row.name, language: row.language, status: 'preview', reason: '' };
    try {
      if (!apply) { console.log(JSON.stringify({ ...result, body })); continue; }
      const { accessToken, wabaId } = await resolverWabaYToken(db, RIVERZOFICIAL_WORKSPACE, row.user_id);
      if (!accessToken || !row.meta_template_id) throw new Error('Missing template ID or WhatsApp credentials');
      const url = withAppsecretProof(`https://graph.facebook.com/v21.0/${row.meta_template_id}`, accessToken);
      const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
      const read = await fetch(url, { headers });
      const remote = await read.json();
      if (!read.ok) throw new Error(remote.error?.message ?? `Meta ${read.status}`);
      if (remote.name !== row.name || remote.language !== row.language) throw new Error('Meta identity mismatch');
      const components = remote.components;
      if (!Array.isArray(components) || !components.some(c => c.type === 'BODY')) throw new Error('Missing Meta body');
      writeFileSync(`tmp/riverzoficial-meta-${run}-${row.id}.json`, JSON.stringify(remote, null, 2));
      if (components.find(c => c.type === 'BODY').text !== body) {
        if (remote.status === 'PENDING') {
          const name = `${row.name}_human_v1`;
          const { data: existing, error: existingError } = await db.from('message_templates').select('*').eq('workspace_id', RIVERZOFICIAL_WORKSPACE).eq('name', name).eq('language', row.language).maybeSingle();
          if (existingError) throw existingError;
          if (existing && existing.body_text !== body) throw new Error('Replacement copy differs; review required');
          if (!existing) {
            const createUrl = withAppsecretProof(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, accessToken);
            const lookupResponse = await fetch(withAppsecretProof(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${encodeURIComponent(name)}`, accessToken), { headers });
            const lookup = await lookupResponse.json();
            if (!lookupResponse.ok) throw new Error(lookup.error?.message ?? 'Replacement lookup failed');
            const found = lookup.data?.find((t: {name: string; language: string}) => t.name === name && t.language === row.language);
            const createResponse = found ? null : await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify({ name, language: row.language, category: remote.category, components: components.map(c => c.type === 'BODY' ? { ...c, text: body } : c) }) });
            const created = found ?? await createResponse!.json();
            if ((!found && !createResponse!.ok) || !created.id) throw new Error(created.error?.error_data?.details ?? created.error?.message ?? 'Replacement failed');
            const check = await fetch(withAppsecretProof(`https://graph.facebook.com/v21.0/${created.id}`, accessToken), { headers });
            const verified = await check.json();
            if (!check.ok || verified.components?.find((c: {type: string}) => c.type === 'BODY')?.text !== body) throw new Error('Replacement readback failed');
            const replacement = { ...row, id: crypto.randomUUID(), name, body_text: body, meta_template_id: created.id, meta_status: verified.status, rejected_reason: null, quality_score: null, status: verified.status === 'APPROVED' ? 'Approved' : 'Pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            delete replacement.short_id;
            const { error: insertError } = await db.from('message_templates').insert(replacement);
            if (insertError) throw insertError;
          }
          for (const flow of flows ?? []) {
            const { data: steps, error: stepError } = await db.from('automation_steps').select('id,step_config').eq('automation_id', flow.id);
            if (stepError) throw stepError;
            for (const step of steps ?? []) {
              if (step.step_config?.template_name !== row.name || (step.step_config.language ?? 'es') !== row.language) continue;
              const { error: bindError } = await db.from('automation_steps').update({ step_config: { ...step.step_config, template_name: name } }).eq('id', step.id).eq('automation_id', flow.id);
              if (bindError) throw bindError;
            }
          }
          result.status = 'replacement-submitted';
          result.reason = name;
          results.push(result);
          writeFileSync(`tmp/riverzoficial-copy-results-${run}.json`, JSON.stringify(results, null, 2));
          console.log(JSON.stringify(result));
          continue;
        }
        if (!['APPROVED', 'REJECTED', 'PAUSED'].includes(remote.status)) throw new Error(`Meta status ${remote.status}: cannot edit yet`);
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ components: components.map(c => c.type === 'BODY' ? { ...c, text: body } : c) }) });
        const edited = await response.json();
        if (!response.ok || !edited.success) throw new Error(edited.error?.error_data?.details ?? edited.error?.message ?? 'Meta did not confirm edit');
      }
      const verify = await fetch(url, { headers });
      const current = await verify.json();
      if (!verify.ok || current.components?.find((c: {type: string}) => c.type === 'BODY')?.text !== body) throw new Error('Meta readback differs; local body left unchanged');
      const statuses: Record<string,string> = { APPROVED:'Approved', PENDING:'Pending', REJECTED:'Rejected', PAUSED:'Paused', DISABLED:'Disabled' };
      if (!statuses[current.status]) throw new Error(`Unmapped Meta status: ${current.status}`);
      const { error: saveError } = await db.from('message_templates').update({ body_text: body, status: statuses[current.status], meta_status: current.status, rejected_reason: null }).eq('id', row.id).eq('workspace_id', RIVERZOFICIAL_WORKSPACE);
      if (saveError) throw saveError;
      result.status = current.status;
    } catch (e) { result.status = 'blocked'; result.reason = e instanceof Error ? e.message : JSON.stringify(e); }
    results.push(result);
    writeFileSync(`tmp/riverzoficial-copy-results-${run}.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(result));
  }
  if (apply) {
    const { reconcileWorkspaceAutomationReadiness } = await import('@/lib/automations/activation');
    await reconcileWorkspaceAutomationReadiness(db, RIVERZOFICIAL_WORKSPACE);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
