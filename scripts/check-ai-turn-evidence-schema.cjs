(async () => {
  if (!process.env.RENDER && process.env.AI_TURN_EVIDENCE_REQUIRE_SCHEMA!=='true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
  const r=await fetch(`${base}/ai_turn_evidence?select=id,inbound_message_id,message_id,evidence,status,reason&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Apply migration 316 before deploying turn evidence (HTTP ${r.status}).`);
  for (const table of ['shopify_products?select=id,workspace_id','messages?select=id,conversation_id,sender_type,deleted_at','agent_guidance?select=id,workspace_id,live_revision','guidance_live_versions?select=rule_id,workspace_id','channel_connections?select=id,workspace_id,created_by']) {
    const r=await fetch(`${base}/${table}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`AI turn evidence dependency unavailable (HTTP ${r.status}).`);
  }
  const probes={
    record_ai_turn_evidence:{ p_id:null,p_workspace_id:null,p_conversation_id:null,p_inbound_id:null,p_message_id:null,p_message_ids:[],p_agent_id:null,p_status:'unknown',p_reason:null,p_evidence:{} },
    ai_rule_context_metrics:{ p_workspace_id:null,p_rule_id:null,p_actor_id:null },
  };
  for (const [name,body] of Object.entries(probes)) {
    const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) }),result=await r.json().catch(() => null);
    if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_ai_evidence') throw new Error(`AI turn evidence RPC unavailable: ${name} (HTTP ${r.status}).`);
  }
  console.log('AI turn evidence schema and RPCs verified.');
})().catch(e => { console.error(e.message);process.exitCode=1; });
