(async () => {
  if (!process.env.RENDER && process.env.GUIDANCE_REPLAYS_REQUIRE_SCHEMA!=='true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
  const table=await fetch(`${base}/guidance_test_runs?select=id,rule_ref,conversation_id,live_revision,draft_revision,result,source&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
  if (!table.ok) throw new Error(`Apply migration 314 before deploying rule tests (HTTP ${table.status}).`);
  const r=await fetch(`${base}/rpc/record_guidance_test`,{ method:'POST',headers,body:JSON.stringify({ p_id:null,p_workspace_id:null,p_rule_id:null,p_conversation_id:null,p_actor_id:null,p_live_revision:1,p_draft_revision:0,p_agent_id:null,p_agent_updated_at:null,p_peer_revisions:[],p_source:{},p_result:{} }),signal:AbortSignal.timeout(15000) });
  const result=await r.json().catch(() => null);
  if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_guidance_context') throw new Error(`Guidance replay RPC unavailable (HTTP ${r.status}).`);
  console.log('Guidance replay schema and RPC verified.');
})().catch(e => { console.error(e.message);process.exitCode=1; });
