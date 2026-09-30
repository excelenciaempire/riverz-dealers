(async () => {
  if (!process.env.RENDER && process.env.GUIDANCE_VERSIONS_REQUIRE_SCHEMA!=='true') return;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY,base=`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
  const headers={ apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json' };
  for (const table of ['agent_guidance?select=live_revision','guidance_live_versions?select=rule_id,revision,snapshot,actor_id,source','guidance_drafts?select=rule_id,base_revision,draft_revision,snapshot,state']) {
    const r=await fetch(`${base}/${table}&limit=0`,{ headers,signal:AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Apply migration 313 before deploying guidance versions (HTTP ${r.status}).`);
  }
  const context={ p_workspace_id:null,p_rule_id:null,p_actor_id:null };
  const probes={
    save_guidance_draft:{ ...context,p_live_revision:1,p_draft_revision:0,p_snapshot:{} },
    publish_guidance_draft:{ ...context,p_live_revision:1,p_draft_revision:1 },
    rollback_guidance_version:{ ...context,p_live_revision:1,p_target_revision:1 },
    create_guidance_rule:{ p_workspace_id:null,p_actor_id:null,p_id:null,p_agent_id:null,p_snapshot:{},p_draft:true },
    discard_guidance_draft:{ ...context,p_draft_revision:1 },
  };
  for (const [name,body] of Object.entries(probes)) {
    const r=await fetch(`${base}/rpc/${name}`,{ method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000) });
    const result=await r.json().catch(() => null),expected=name==='publish_guidance_draft' || name==='rollback_guidance_version' ? 'guidance_admin_required' : 'invalid_guidance_context';
    if (r.ok || result?.code!=='P0001' || result?.message!==expected) throw new Error(`Guidance versions RPC unavailable: ${name} (HTTP ${r.status}).`);
  }
  console.log('Guidance versions schema and RPCs verified.');
})().catch(e => { console.error(e.message);process.exitCode=1; });
