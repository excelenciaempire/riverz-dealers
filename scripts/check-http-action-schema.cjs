(async () => {
  if (!process.env.RENDER && process.env.HTTP_ACTION_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/manage_http_action`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_actor_id: null, p_operation: 'list' }), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (response.ok || body?.code !== 'P0001' || body?.message !== 'invalid_http_action_context') {
    throw new Error(`Apply migration 330 before deploying HTTP action configuration (HTTP ${response.status}).`);
  }
  for (const table of ['http_actions?select=id,workspace_id,definition,credential_ciphertext,state,revision',
    'http_action_versions?select=action_id,workspace_id,revision,definition,credential_present']) {
    const result = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const rows = await result.json().catch(() => null);
    if (!result.ok || !Array.isArray(rows) || rows.length !== 0) throw new Error('HTTP action configuration columns unavailable.');
  }
  console.log('HTTP action configuration RPC and columns verified without reading action data.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
