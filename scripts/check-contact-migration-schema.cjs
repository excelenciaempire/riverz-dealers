if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
 (async()=>{const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/contact_migration_ready`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!response.ok||await response.json().catch(()=>null)!==true)throw new Error('Apply migration 360 before building contact migration reviews');
 console.log('Contact migration reviews: current private schema ready');
 })().catch(error=>{console.error(error.message);process.exitCode=1;});
}else console.log('Contact migration reviews: environment not configured; schema check skipped');
