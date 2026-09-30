(async () => {
  if (!process.env.RENDER && process.env.AUTOMATION_EVENTS_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const table of ['automation_event_jobs?select=id,event_type,status,context', 'automation_schedule_slots?select=automation_id,slot', 'approval_requests?select=contact_id']) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Apply migration 303 before deploying automation events (HTTP ${response.status}).`);
  }
  console.log('Automation events schema verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
