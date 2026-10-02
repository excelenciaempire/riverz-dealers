// Production deploys require the independent dealer schema. Local demo needs no DB.
(async () => {
  if (!process.env.RENDER && process.env.DEALERS_REQUIRE_SCHEMA !== 'true')
    return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      'Configure the independent Riverz Dealers Supabase project.'
    );
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  for (const table of [
    'dealer_vehicles',
    'dealer_opportunities',
    'dealer_interests',
    'dealer_appointments',
  ]) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new Error(
        `Apply dealer migration 375 before deploying (${table}, HTTP ${res.status}).`
      );
  }
  console.log('Dealer schema verified.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
