if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
 (async()=>{const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/help_portal_avoidance_ready`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!response.ok||await response.json().catch(()=>null)!==true)throw new Error('Apply migrations 364–366 before building reviewed help portals');
 console.log('Help portals: private publication and visitor schema ready');
 })().catch(error=>{console.error(error.message);process.exitCode=1;});
}else console.log('Help portals: environment not configured; schema check skipped');
