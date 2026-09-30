module.exports = (async () => {
 if (!process.env.RENDER && process.env.BROADCAST_DELIVERY_REQUIRE_SCHEMA !== 'true') return;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
 const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
 const table=await fetch(`${base}/broadcast_delivery_receipts?select=id,workspace_id,broadcast_id,recipient_key,recipient_id,state,payload_hash,destination_hash,provider_message_id&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
 if (!table.ok) throw new Error(`Apply migration 322 before deploying durable campaign sends (HTTP ${table.status}).`);
 for (const [name,body] of [
  ['claim_broadcast_delivery',{p_id:null,p_workspace_id:null,p_broadcast_id:null,p_recipient_id:null,p_actor_id:null,p_destination_hash:null,p_payload_hash:null,p_source:null}],
  ['finish_broadcast_delivery',{p_id:null,p_state:null,p_message_id:null,p_error_code:null}],
  ['finalize_broadcast_delivery_progress',{p_workspace_id:null,p_broadcast_id:null,p_actor_id:null,p_defer_seconds:null}]
 ]) {
  const r=await fetch(`${base}/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const error=await r.json().catch(() => null);
  if (r.ok || error?.code!=='P0001' || error?.message!=='invalid_broadcast_receipt') throw new Error(`Campaign delivery RPC unavailable (HTTP ${r.status}).`);
 }
 console.log('Durable campaign delivery schema and RPCs verified.');
})().catch(error => {console.error(error.message);process.exitCode=1;});
