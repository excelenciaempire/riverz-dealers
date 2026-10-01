(async () => {
  const { existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  if (!existsSync(resolve(process.cwd(), 'scripts/extract-ai-document.mjs'))) throw new Error('Local document extraction worker missing.');
  if (!process.env.RENDER && process.env.AI_DOCUMENT_SOURCES_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/manage_ai_document_source`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_actor_id: null, p_agent_id: null, p_action: 'list' }), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (response.ok || body?.code !== 'P0001' || body?.message !== 'invalid_document_context') throw new Error(`Apply migration 329 before deploying document sources (HTTP ${response.status}).`);
  const active = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/active_ai_document_sources`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_agent_id: null }), signal: AbortSignal.timeout(15000),
  });
  const rows = await active.json().catch(() => null);
  if (!active.ok || !Array.isArray(rows) || rows.length !== 0) throw new Error('Document context read guard unavailable.');
  console.log('Document source RPCs and context guard verified.');
})().catch(error => { console.error(error.message);process.exitCode = 1; });
