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
  const claim = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/claim_http_action`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_actor_id: null, p_action_id: null, p_revision: null,
      p_invocation_key: null, p_input_hash: null }), signal: AbortSignal.timeout(15000),
  });
  const claimBody = await claim.json().catch(() => null);
  if (claim.ok || claimBody?.code !== 'P0001' || claimBody?.message !== 'invalid_http_execution_context') {
    throw new Error(`Apply migration 331 before deploying HTTP action execution (HTTP ${claim.status}).`);
  }
  const finish = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/finish_http_action`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_run_id: null, p_lease_id: null, p_state: null }), signal: AbortSignal.timeout(15000),
  });
  const finishBody = await finish.json().catch(() => null);
  if (finish.ok || finishBody?.code !== 'P0001' || finishBody?.message !== 'invalid_http_execution_receipt') {
    throw new Error(`Apply migration 331 before deploying HTTP action receipts (HTTP ${finish.status}).`);
  }
  const grant = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/manage_http_action_assistant_grant`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_actor_id: null, p_action_id: null, p_operation: 'list' }), signal: AbortSignal.timeout(15000),
  });
  const grantBody = await grant.json().catch(() => null);
  if (grant.ok || grantBody?.code !== 'P0001' || grantBody?.message !== 'invalid_http_grant_context') {
    throw new Error(`Apply migration 332 before deploying HTTP assistant grants (HTTP ${grant.status}).`);
  }
  const assistant = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/claim_http_action_assistant`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_agent_id: null, p_action_id: null, p_revision: null, p_channel: null,
      p_grant_revision: null, p_invocation_key: null, p_input_hash: null, p_conversation_id: null, p_context: null, p_parameters: null }),
    signal: AbortSignal.timeout(15000),
  });
  const assistantBody = await assistant.json().catch(() => null);
  if (assistant.ok || assistantBody?.code !== 'P0001' || assistantBody?.message !== 'invalid_http_assistant_identity_context') {
    throw new Error(`Apply migrations 333/334/335 before deploying assistant HTTP execution (HTTP ${assistant.status}).`);
  }
  for (const table of ['http_actions?select=id,workspace_id,definition,credential_ciphertext,state,revision',
    'http_action_versions?select=action_id,workspace_id,revision,definition,credential_present',
    'http_action_runs?select=id,workspace_id,action_id,action_revision,actor_id,conversation_id,invocation_key,input_hash,lease_id,state,status_code,error_code,result,created_at,finished_at,source_kind,source_agent_id,source_channel,source_grant_revision,source_approval_id',
    'http_action_assistant_grants?select=workspace_id,action_id,agent_id,channel,context_scope,action_revision,revision,state,granted_by,updated_at',
    'http_action_assistant_grant_versions?select=workspace_id,action_id,agent_id,channel,revision,action_revision,context_scope,state,granted_by,observed_at']) {
    const result = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const rows = await result.json().catch(() => null);
    if (!result.ok || !Array.isArray(rows) || rows.length !== 0) throw new Error('HTTP action configuration columns unavailable.');
  }
  console.log('HTTP action human/assistant execution, configuration and grant RPCs verified without reading action data.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
