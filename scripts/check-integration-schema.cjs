// Keep the previous deployment serving until durable recovery state exists.
(async () => {
  if (!process.env.RENDER && process.env.INTEGRATION_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/shopify_connections?select=sync_state&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Apply migration 255 before deploying integration recovery (HTTP ${response.status}).`);
  const email = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/workspace_email_policy?select=mode,whatsapp_number&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
  });
  if (!email.ok) throw new Error(`Apply migration 290 before deploying email policy (HTTP ${email.status}).`);
  for (const table of ['mp_pending_payments?select=mp_payment_id,status,dispatched_at', 'pending_payment_sequences?select=owner_log_id,expires_at']) {
    const pending = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    if (!pending.ok) throw new Error(`Apply migration 296 before deploying pending Mercado Pago recovery (HTTP ${pending.status}).`);
  }
  console.log('Integration recovery schema verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
