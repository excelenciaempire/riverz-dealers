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
  const flowBase = { p_workspace_id: null, p_run_id: null, p_flow_id: null, p_node_key: null,
    p_expected_advanced_at: null, p_expected_vars: null };
  for (const [name, args] of [
    ['manage_http_flow_grant', { p_workspace_id: null, p_actor_id: null, p_flow_id: null, p_operation: 'list' }],
    ['claim_http_action_flow', { ...flowBase, p_config: null, p_grant_revision: null, p_expected_node: null,
      p_invocation_key: null, p_input_hash: null, p_context: null }],
    ['finish_http_action_flow', { ...flowBase, p_config: null, p_grant_revision: null, p_receipt_id: null, p_vars: null }],
    ['fail_http_action_flow', { ...flowBase, p_expected_node: null }],
    ['prepare_http_flow_post', { p_workspace_id:null,p_run_id:null,p_flow_id:null,p_node_key:null,p_config:null,
      p_grant_revision:null,p_expected_node:null,p_visit_at:null,p_vars:null,p_input_hash:null,p_locale:null }],
    ['claim_http_flow_post', { p_workspace_id:null,p_approval_id:null,p_actor_id:null,p_input_hash:null }],
    ['finish_http_flow_post', { p_workspace_id:null,p_approval_id:null,p_vars:null }],
  ]) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null);
    if (response.ok || result?.code !== 'P0001' || result?.message !== 'invalid_http_flow_context') {
      throw new Error(`Apply migrations 337 and 341 before deploying native HTTP flows (HTTP ${response.status}).`);
    }
  }
  for (const table of ['http_actions?select=id,workspace_id,definition,credential_ciphertext,state,revision',
    'http_action_versions?select=action_id,workspace_id,revision,definition,credential_present',
    'http_action_runs?select=id,workspace_id,action_id,action_revision,actor_id,conversation_id,invocation_key,input_hash,lease_id,state,status_code,error_code,result,created_at,finished_at,source_kind,source_agent_id,source_channel,source_grant_revision,source_approval_id',
    'http_action_assistant_grants?select=workspace_id,action_id,agent_id,channel,context_scope,action_revision,revision,state,granted_by,updated_at',
    'http_action_assistant_grant_versions?select=workspace_id,action_id,agent_id,channel,revision,action_revision,context_scope,state,granted_by,observed_at',
    'http_action_flow_grants?select=workspace_id,flow_id,node_key,action_id,action_revision,node_config,revision,state,granted_by,updated_at',
    'http_action_flow_grant_versions?select=workspace_id,flow_id,node_key,action_id,action_revision,node_config,revision,state,granted_by,observed_at',
    'http_action_flow_receipts?select=workspace_id,flow_run_id,flow_id,node_key,receipt_id,visit_at',
    'http_action_flow_approvals?select=workspace_id,flow_run_id,flow_id,node_key,visit_at,approval_id,node_config,grant_revision,observed_vars,input_hash,invocation_key']) {
    const result = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    const rows = await result.json().catch(() => null);
    if (!result.ok || !Array.isArray(rows) || rows.length !== 0) throw new Error('HTTP action configuration columns unavailable.');
  }
  const review = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/http_approval_review_ready`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}), signal: AbortSignal.timeout(15000),
  });
  if (!review.ok || await review.json().catch(() => null) !== true) {
    throw new Error(`Apply migrations 339 and 340 before deploying protected HTTP review (HTTP ${review.status}).`);
  }
  const postReview = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/http_flow_post_ready`, {
    method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(15000),
  });
  if (!postReview.ok || await postReview.json().catch(() => null) !== true) throw new Error('Apply migration 341 before deploying per-operation HTTP flow review.');
  const binding = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/http_flow_post_receipt_binding_ready`, {
    method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(15000),
  });
  if (!binding.ok || await binding.json().catch(() => null) !== true) throw new Error('Apply migration 343 before deploying exact HTTP flow receipt observation.');
  const recovery = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/http_flow_recorded_recovery_ready`, {
    method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(15000),
  });
  if (!recovery.ok || await recovery.json().catch(() => null) !== true) throw new Error('Apply migration 344 before deploying recorded HTTP flow recovery.');
  console.log('HTTP action execution, grants and individual immutable review verified without reading action data.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
