(async()=>{
 if(!process.env.RENDER && process.env.BILLING_RECOVERY_REQUIRE_SCHEMA!=='true')return;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const headers={apikey:key,Authorization:`Bearer ${key}`};
 for(const table of ['messages?select=billing_recovery_eligible','workspace_billing_invoices?select=paid_confirmed_at','billing_reply_backlog?select=inbound_message_id,lease_id','workspace_billing_notices?select=id,channel,phase']) {
  const r=await fetch(`${url}/rest/v1/${table}&limit=0`,{headers,signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`Apply migration 306 before deploying billing recovery (HTTP ${r.status}).`);
 }
 const gate=await fetch(`${url}/rest/v1/rpc/workspace_billing_write_allowed`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_workspace:'00000000-0000-0000-0000-000000000000'}),signal:AbortSignal.timeout(15000)});
 if(!gate.ok || typeof await gate.json()!=='boolean')throw new Error('Billing write gate is unavailable. Apply migration 306.');
 const recoveryGate=await fetch(`${url}/rest/v1/rpc/billing_recovery_payment_cleared`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_workspace:'00000000-0000-0000-0000-000000000000'}),signal:AbortSignal.timeout(15000)});
 if(!recoveryGate.ok || typeof await recoveryGate.json()!=='boolean')throw new Error('Billing grace handoff is unavailable. Apply migration 309.');
 // Extend the guard to new business tables before publishing code that uses them.
 for(const rpc of ['install_billing_business_guards','billing_business_guards_covered']) {
  const r=await fetch(`${url}/rest/v1/rpc/${rpc}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
  if(!r.ok || rpc==='billing_business_guards_covered' && await r.json()!==true)throw new Error('Billing business table coverage is unavailable. Apply migration 308.');
 }
 console.log('Billing read-only, notification and recovery schema verified.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
