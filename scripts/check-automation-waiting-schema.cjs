module.exports = (async () => {
  if (!process.env.RENDER && process.env.AUTOMATION_WAITING_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/automation_waiting_counts`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_workspace_id: null, p_automation_id: null, p_actor_id: null }), signal: AbortSignal.timeout(15000),
  });
  const error = await response.json().catch(() => null);
  if (response.ok || error?.code !== 'P0001' || error?.message !== 'automation_waiting_not_found') throw new Error(`Apply migration 326 before deploying automation waiting counts (HTTP ${response.status}).`);
  console.log('Automation waiting counts RPC verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
