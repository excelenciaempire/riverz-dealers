(async () => {
  if (!process.env.RENDER && process.env.RETURN_HISTORY_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/return_case_events?select=id,event_sequence,workspace_id,case_id,event_type,occurred_at,actor_id,snapshot,previous_snapshot&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Apply migration 327 before deploying return history (HTTP ${response.status}).`);
  console.log('Return case history columns verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
