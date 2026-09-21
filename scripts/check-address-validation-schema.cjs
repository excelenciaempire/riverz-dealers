(async () => {
  if (
    !process.env.RENDER &&
    process.env.ADDRESS_VALIDATION_REQUIRE_SCHEMA !== 'true'
  )
    return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const response = await fetch(
    `${url}/rest/v1/workspace_integrations?provider=eq.google_address_validation&select=id,is_active&limit=0`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Apply migration 266 before deploying Google address validation (HTTP ${response.status}).`
    );
  }
  console.log('Address validation schema verified.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
