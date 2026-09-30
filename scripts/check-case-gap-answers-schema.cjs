module.exports=(async() => {
 if (!process.env.RENDER && process.env.CASE_GAP_ANSWERS_REQUIRE_SCHEMA!=='true') return;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
 const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
 const r=await fetch(`${base}/case_gap_answers?select=id,workspace_id,conversation_id,gap_id,revision,actor_id,answer,created_at&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
 if (!r.ok) throw new Error(`Apply migration 318 before deploying case answers (HTTP ${r.status}).`);
 const probes={ list_case_gap_answers:{ p_workspace_id:null,p_actor_id:null,p_conversation_id:null },save_case_gap_answer:{ p_id:null,p_workspace_id:null,p_actor_id:null,p_conversation_id:null,p_gap_id:null,p_expected_revision:0,p_answer:null } };
 for (const [name,body] of Object.entries(probes)) {
  const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) }),result=await r.json().catch(() => null);
  if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_gap_context') throw new Error(`Case answer RPC unavailable: ${name} (HTTP ${r.status}).`);
 }
 console.log('Case answers schema and RPCs verified.');
 await require('./check-case-gap-notices-schema.cjs');
})().catch(e => { console.error(e.message);process.exitCode=1; });
