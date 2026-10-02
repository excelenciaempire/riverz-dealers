if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
 (async()=>{const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/whatsapp_calling_ready`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!response.ok||await response.json().catch(()=>null)!==true)throw new Error('Apply migration 370 before building private WhatsApp Calling');
 console.log('WhatsApp Calling: current private schema ready');
 })().catch(error=>{console.error(error.message);process.exitCode=1;});
}else console.log('WhatsApp Calling: environment not configured; schema check skipped');
