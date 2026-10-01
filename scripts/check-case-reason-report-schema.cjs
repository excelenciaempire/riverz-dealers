(async () => {
  if (!process.env.RENDER && process.env.CASE_REASON_REPORT_REQUIRE_SCHEMA!=='true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/case_reason_report`, {
    method:'POST',headers:{ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' },
    body:JSON.stringify({ p_workspace_id:null,p_actor_id:null,p_start:null,p_end:null,p_previous_start:null,p_previous_end:null }),signal:AbortSignal.timeout(15000),
  });
  const body=await response.json().catch(() => null);
  if (response.ok || body?.code!=='P0001' || body?.message!=='invalid_case_reason_context') throw new Error(`Apply migration 328 before deploying case reason reports (HTTP ${response.status}).`);
  console.log('Case reason report RPC and context guard verified.');
})().catch(error => { console.error(error.message);process.exitCode=1; });
