(async () => {
  if (!process.env.RENDER && process.env.INBOX_NATIVE_BLOCKS_REQUIRE_SCHEMA!=='true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
  for (const table of ['inbox_native_blocks?select=id,status,preview,result,review,dispatched_at','inbox_native_block_locks?select=workspace_id,phone_number_id,recipient,operation_id,status']) {
    const r=await fetch(`${base}/${table}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Apply migration 312 before deploying native blocking (HTTP ${r.status}).`);
  }
  const context={ p_id:null,p_workspace_id:null,p_conversation_id:null,p_actor_id:null };
  const probes={
    prepare_inbox_native_block:{ ...context,p_phone:null,p_recipient:null,p_desired:true,p_expected:false,p_fingerprint:null,p_preview:{} },
    claim_inbox_native_block:{ ...context,p_fingerprint:null },
    authorize_inbox_native_block_dispatch:context,
    finish_inbox_native_block:{ p_id:null,p_workspace_id:null,p_status:'failed',p_result:{} },
    review_inbox_native_block:{ ...context,p_reason:'Schema check',p_snapshot:{} },
  };
  for (const [name,body] of Object.entries(probes)) {
    const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) });
    const result=await r.json().catch(() => null);
    if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_native_block') throw new Error(`Native block RPC unavailable: ${name} (HTTP ${r.status}).`);
  }
  console.log('Native block schema and RPCs verified.');
})().catch(e => { console.error(e.message);process.exitCode=1; });
