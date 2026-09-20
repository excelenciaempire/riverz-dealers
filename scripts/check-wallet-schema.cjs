// Do not replace a working production deployment before its wallet migration exists.
(async () => {
  if (!process.env.RENDER && process.env.WALLET_REQUIRE_SCHEMA !== 'true')
    return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      'Wallet deployment requires Supabase credentials and migration 253.'
    );
  for (const [table, select] of [
    ['wallet_accounts', 'reservado_centavos,resto_costo_centavos'],
    ['workspace_subscriptions', 'modelo_cobro'],
    ['wallet_operaciones', 'id'],
    ['wallet_auto_intentos', 'id'],
    ['wallet_provider_receipts', 'id'],
  ]) {
    const res = await fetch(
      `${url}/rest/v1/${table}?select=${select}&limit=0`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok)
      throw new Error(
        `Wallet pricing schema is unavailable (${table}, HTTP ${res.status}). Apply migrations through 263 before deploying.`
      );
  }
  console.log('Wallet schema verified.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
