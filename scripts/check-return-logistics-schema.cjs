if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
 (async()=>{
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/return_logistics_ready`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
  if(!response.ok||await response.json().catch(()=>null)!==true)throw new Error('Apply migration 352 before deploying return logistics evidence.');
  console.log('Private return logistics evidence verified without reading cases.');
 })().catch(error=>{console.error(error.message);process.exitCode=1;});
}
