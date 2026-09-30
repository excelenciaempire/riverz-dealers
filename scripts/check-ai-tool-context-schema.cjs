module.exports=(async() => {
 if (!process.env.RENDER && process.env.AI_TOOL_CONTEXT_REQUIRE_SCHEMA!=='true') return;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`,headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
 for (const path of ['ai_tool_context_policies?select=agent_id,workspace_id,revision,policy,updated_by,updated_at','ai_tool_context_policy_versions?select=id,agent_id,workspace_id,revision,policy,actor_id,created_at']) {
  const r=await fetch(`${base}/${path}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });if (!r.ok) throw new Error(`Apply migration 321 before deploying contextual tool permissions (HTTP ${r.status}).`);
 }
 const r=await fetch(`${base}/rpc/save_ai_tool_context_policy`,{ method:'POST',headers,body:JSON.stringify({ p_id:null,p_workspace_id:null,p_actor_id:null,p_agent_id:null,p_expected_revision:null,p_policy:null }),signal:AbortSignal.timeout(15000) }),result=await r.json().catch(() => null);
 if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_tool_context') throw new Error(`Contextual tool policy RPC unavailable (HTTP ${r.status}).`);
 console.log('Contextual tool permission schema and RPC verified.');
 await (await import('./check-broadcast-delivery-schema.cjs')).default;
})().catch(e => { console.error(e.message);process.exitCode=1; });
