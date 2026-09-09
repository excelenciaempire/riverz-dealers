/** Refresh provider truth, then use the same activation gate as production webhooks. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { decrypt } = await import('@/lib/whatsapp/encryption');
  const { handleTemplateStatusUpdate } = await import('@/lib/whatsapp/template-webhooks');
  const { fetchWhatsAppAccountHealth, persistWhatsAppHealthSnapshot } = await import('@/lib/whatsapp/account-health');
  const { reconcileWorkspaceAutomationReadiness } = await import('@/lib/automations/activation');
  const { data: connection, error } = await db.from('channel_connections').select('id,config,secrets')
    .eq('workspace_id', workspaceId).eq('channel', 'whatsapp').eq('status', 'connected').single();
  if (error) throw error;
  const accessToken = decrypt(connection.secrets.access_token);
  const { data: templates, error: templateError } = await db.from('message_templates')
    .select('name,language,meta_template_id').eq('workspace_id', workspaceId).like('name', 'deuna_%');
  if (templateError) throw templateError;
  for (const template of templates ?? []) {
    if (!template.meta_template_id) continue;
    const response = await fetch(`https://graph.facebook.com/v25.0/${template.meta_template_id}?fields=status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Meta status lookup: ${response.status}`);
    const remote = await response.json() as { status: string };
    await handleTemplateStatusUpdate(db, connection.config.waba_id, {
      event: remote.status, message_template_name: template.name, message_template_language: template.language,
    });
    console.log(JSON.stringify({ template: template.name, status: remote.status }));
  }
  const health = await fetchWhatsAppAccountHealth({ accessToken,
    phoneNumberId: connection.config.phone_number_id, wabaId: connection.config.waba_id,
  });
  await persistWhatsAppHealthSnapshot(db, connection.id, health);
  console.log(JSON.stringify({ health, flows: await reconcileWorkspaceAutomationReadiness(db, workspaceId) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
