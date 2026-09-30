module.exports=(async() => {
 if (!process.env.RENDER && process.env.CASE_GAP_NOTICES_REQUIRE_SCHEMA!=='true') return;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
 const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
 for (const path of ['case_gap_question_notices?select=id,workspace_id,conversation_id,gap_id,actor_id,created_at','case_gap_question_recipients?select=notice_id,recipient_hash,state,claim_id,provider_message_id,updated_at']) {
  const r=await fetch(`${base}/${path}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Apply migration 319 before deploying internal question notices (HTTP ${r.status}).`);
 }
 const probes={ list_case_gap_notices:{ p_workspace_id:null,p_actor_id:null,p_conversation_id:null },case_gap_notice_status:{ p_workspace_id:null,p_actor_id:null,p_gap_id:null },reserve_case_gap_notice:{ p_id:null,p_workspace_id:null,p_actor_id:null,p_conversation_id:null,p_gap_id:null,p_recipient_hashes:[] },claim_case_gap_notice:{ p_id:null,p_workspace_id:null,p_actor_id:null,p_recipient_hash:null,p_claim_id:null,p_destination_current:false },finish_case_gap_notice:{ p_id:null,p_recipient_hash:null,p_claim_id:null,p_state:null,p_provider_message_id:null } };
 for (const [name,body] of Object.entries(probes)) {
  const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) }),result=await r.json().catch(() => null);
  if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_gap_context') throw new Error(`Case question notice RPC unavailable: ${name} (HTTP ${r.status}).`);
 }
 console.log('Internal question notice schema and RPCs verified.');
})().catch(e => { console.error(e.message);process.exitCode=1; });
