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
    'dealer_activities',
    'dealer_settings',
    'dealer_sync_runs',
    'dealer_appointment_links',
    'dealer_credentials',
    'dealer_coaching',
    'dealer_stage_history',
    'dealer_lead_receipts',
  ]) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new Error(
        `Apply dealer migrations through 381 before deploying (${table}, HTTP ${res.status}).`
      );
  }
  const guard = await fetch(`${url}/rest/v1/rpc/dealer_automation_allowed`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_workspace: null,
      p_contact: null,
      p_event: 'dealer_follow_up_due',
      p_vars: {},
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!guard.ok || (await guard.json()) !== false)
    throw new Error(
      `Apply dealer automation migration 376 before deploying (HTTP ${guard.status}).`
    );
  console.log('Dealer schema verified.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
