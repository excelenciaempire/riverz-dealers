// Keep the previous deployment serving until durable recovery state exists.
(async () => {
  if (!process.env.RENDER && process.env.INTEGRATION_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/shopify_connections?select=sync_state&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Apply migration 255 before deploying integration recovery (HTTP ${response.status}).`);
  console.log('Integration recovery schema verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
