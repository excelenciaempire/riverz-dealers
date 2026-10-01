if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
 (async()=>{
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/http_action_run_history_ready`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
  if(!response.ok||await response.json().catch(()=>null)!==true)throw new Error('Apply migration 349 before deploying private integration receipt history.');
  console.log('Private integration history schema verified without reading receipts.');
 })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
