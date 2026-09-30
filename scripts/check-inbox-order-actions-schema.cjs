(async () => {
  if (!process.env.RENDER && process.env.INBOX_ORDER_ACTIONS_REQUIRE_SCHEMA !== 'true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
  for (const table of ['approval_requests?select=execution_result','inbox_order_actions?select=id,fingerprint,status,approved_by,result','order_execution_locks?select=source_id,source_kind,status','order_execution_reviews?select=reviewed_by,snapshot']) {
    const r=await fetch(`${base}/${table}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Apply migration 310 before deploying reviewed order actions (HTTP ${r.status}).`);
  }
  // Null context cannot claim or execute a real operation; this also verifies the RPC contracts.
  const probes={
    save_inbox_order_preview:{ p_id:null,p_workspace_id:null,p_conversation_id:null,p_order_id:null,p_actor_id:null,p_action:{},p_preview:{},p_fingerprint:null },
    claim_inbox_order_action:{ p_id:null,p_workspace_id:null,p_conversation_id:null,p_actor_id:null },
    finish_inbox_order_action:{ p_id:null,p_workspace_id:null,p_status:'failed',p_result:{} },
    claim_approved_order_execution:{ p_workspace_id:null,p_order_id:null,p_approval_id:null },
    finish_approved_order_execution:{ p_workspace_id:null,p_approval_id:null,p_uncertain:true },
    review_order_execution:{ p_workspace_id:null,p_conversation_id:null,p_order_id:null,p_actor_id:null,p_source_id:null,p_reason:'Schema check',p_snapshot:{} },
  };
  for (const [name,body] of Object.entries(probes)) {
    const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) });
    const error=await r.json().catch(() => null);
    if (!r.ok && error?.code !== 'P0001') throw new Error(`Order action RPC unavailable: ${name} (HTTP ${r.status}).`);
  }
  console.log('Reviewed order action schema and RPCs verified.');
})().catch(error => { console.error(error.message); process.exitCode=1; });
