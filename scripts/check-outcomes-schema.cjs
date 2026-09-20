// Keep the current deployment alive until verified-outcome storage exists.
(async () => {
  if (!process.env.RENDER && process.env.OUTCOMES_REQUIRE_SCHEMA !== 'true')
    return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('Outcome verification requires Supabase credentials.');
  const res = await fetch(
    `${url}/rest/v1/conversation_outcomes?select=conversation_id,last_message_id,category,verified_at&limit=0`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok)
    throw new Error(
      `Apply migration 265 before deploying the results dashboard (HTTP ${res.status}).`
    );
  console.log('Outcome verification schema verified.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
