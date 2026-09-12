// Read-only production schema audit. Credentials come exclusively from the environment.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !token) throw new Error('Supabase URL and management token are required.');
const ref = new URL(url).hostname.split('.')[0];
const query = `BEGIN READ ONLY;
SELECT json_build_object(
  'tables_without_rls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
  'unrestricted_write_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND (qual IN ('true','(true)') OR with_check IN ('true','(true)')) AND roles && ARRAY['public','anon','authenticated']::name[]),
  'exposed_privileged_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('wallet_mover','wallet_acumular','claim_voice_call_with_capacity','_bcast_bump','recompute_broadcast_counts','get_waba_24h_sent_count','update_webchat_settings','admin_platform_overview') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')))
) AS audit;
COMMIT;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: {Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query}), signal:AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Schema audit failed: HTTP ${response.status}`);
const [{audit}] = await response.json();
console.log(JSON.stringify(audit));
if (Object.values(audit).some(count => count !== 0)) process.exitCode=1;
