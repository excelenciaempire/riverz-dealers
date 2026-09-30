(async () => {
  if (!process.env.RENDER && process.env.INBOX_DISPOSITION_REQUIRE_SCHEMA !== 'true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
  for (const table of ['conversations?select=manual_unread,is_spam,inbox_control_version','inbox_disposition_events?select=id,action,actor_id,result']) {
    const r=await fetch(`${base}/${table}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Apply migration 311 before deploying inbox disposition (HTTP ${r.status}).`);
  }
  // Invalid context fails before any write, proving the RPC is installed.
  const r=await fetch(`${base}/rpc/set_inbox_disposition`,{ method:'POST',headers,body:JSON.stringify({ p_id:null,p_workspace_id:null,p_conversation_id:null,p_actor_id:null,p_action:'read',p_expected_version:0 }),signal:AbortSignal.timeout(15000) });
  const result=await r.json().catch(() => null);
  if (r.ok || result?.code!=='P0001' || result?.message!=='invalid_inbox_disposition') throw new Error(`Inbox disposition RPC unavailable (HTTP ${r.status}).`);
  console.log('Inbox disposition schema and RPC verified.');
})().catch(error => { console.error(error.message);process.exitCode=1; });
