module.exports=(async() => {
 if (!process.env.RENDER && process.env.CASE_GAP_CONTEXT_REQUIRE_SCHEMA!=='true') return;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
 const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
 for (const path of ['case_gap_answers?select=id,workspace_id,conversation_id,gap_id,revision,question_snapshot,actor_id,answer,created_at','ai_agents?select=id,workspace_id,is_active']) {
  const r=await fetch(`${base}/${path}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Apply migration 320 before deploying case-scoped knowledge context (HTTP ${r.status}).`);
 }
 const r=await fetch(`${base}/rpc/load_case_gap_model_context`,{ method:'POST',headers,body:JSON.stringify({ p_workspace_id:null,p_conversation_id:null,p_agent_id:null }),signal:AbortSignal.timeout(15000) }),result=await r.json().catch(() => null);
 if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_gap_context') throw new Error(`Case-scoped model context RPC unavailable (HTTP ${r.status}).`);
 console.log('Case-scoped knowledge context schema and RPC verified.');
 await (await import('./check-ai-tool-context-schema.cjs')).default;
})().catch(e => { console.error(e.message);process.exitCode=1; });
