(async() => {
 if (!process.env.RENDER && process.env.GAP_KNOWLEDGE_REQUIRE_SCHEMA!=='true') return;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
 const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
 for (const path of ['gap_knowledge_reviews?select=id,workspace_id,actor_id,state,source_ids,expected_snapshot,prepared,published_at','answer_gaps?select=id,workspace_id,conversation_id,source_conversation_required,channel,question_key,resolved_at','shopify_products?select=id,workspace_id,custom_faqs,training_material','agent_guidance?select=id,workspace_id,clave,live_revision','conversations?select=id,workspace_id,channel,connection_id,deleted_at','channel_connections?select=id,workspace_id,created_by']) {
  const r=await fetch(`${base}/${path}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Apply migration 317 before deploying supervised knowledge (HTTP ${r.status}).`);
 }
 const probes={
  list_visible_answer_gaps:{ p_workspace_id:null,p_actor_id:null,p_resolved:false },
  resolve_visible_answer_gaps:{ p_workspace_id:null,p_actor_id:null,p_key:null },
  gap_existing_guidance:{ p_workspace_id:null,p_actor_id:null,p_key:null },
  prepare_gap_knowledge_review:{ p_id:null,p_workspace_id:null,p_actor_id:null,p_key:null,p_question:null,p_answer:null,p_destination:null,p_target_id:null,p_target_title:null,p_source_ids:[],p_expected:null,p_prepared:{},p_previous:[] },
  confirm_gap_knowledge_review:{ p_workspace_id:null,p_actor_id:null,p_review_id:null },
 };
 for (const [name,body] of Object.entries(probes)) {
  const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) }),result=await r.json().catch(() => null);
  if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_gap_context') throw new Error(`Supervised knowledge RPC unavailable: ${name} (HTTP ${r.status}).`);
 }
 console.log('Supervised knowledge schema, privacy dependencies and RPCs verified.');
 await import('./check-case-gap-answers-schema.cjs');
})().catch(e => { console.error(e.message);process.exitCode=1; });
