import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  signals: [] as Array<{ provider: string; key_digest: string; state: string }>,
}));
vi.mock('./claves', () => ({
  leerClaveAnthropicParaSonda: async () => 'anthropic-test',
  proveedorConClave: () => null,
  proveedorActivoEnAdmin: (id: string) => id !== 'apify',
}));
vi.mock('@/lib/ai/jev', () => ({ sondaJev: async () => ({ ok: true }) }));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: async () => ({ data: mock.signals, error: null }) }),
  }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', mock.fetch);
  mock.fetch.mockReset();
  mock.signals = [];
  for (const key of [
    'GROQ_API_KEY',
    'OPENAI_API_KEY',
    'CEREBRAS_API_KEY',
    'GEMINI_API_KEY',
    'TYPESAFE_API_KEY',
    'TELNYX_API_KEY',
    'DEEPGRAM_API_KEY',
    'FISH_API_KEY',
    'ELEVENLABS_API_KEY',
    'FIRECRAWL_API_KEY',
  ])
    vi.stubEnv(key, 'test');
  mock.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/projects'))
      return Response.json({ projects: [{ project_id: 'project' }] });
    if (url.includes('/balances')) return Response.json({ balances: [] });
    if (url.includes('fish.audio')) return Response.json({ credit: '3.5' });
    if (url.includes('telnyx'))
      return Response.json({
        data: { available_credit: '2', currency: 'USD' },
      });
    if (url.includes('credit-usage'))
      return Response.json({ data: { remainingCredits: 100 } });
    return Response.json({ data: [] });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('preserves observed Groq credit failures when the free model catalog still works', async () => {
  const { creditKeyDigest } = await import('./provider-credit');
  mock.signals = [
    {
      provider: 'groq',
      key_digest: creditKeyDigest('test'),
      state: 'sin_saldo',
    },
  ];
  const { leerSaldosParaRecarga } = await import('./proveedores');
  const data = await leerSaldosParaRecarga();
  expect(data.proveedores.find((p) => p.id === 'groq')).toMatchObject({
    estado: 'sin_saldo',
    saldo: null,
  });
});
it('shares concurrent refreshes, never generates paid completions and skips retired Apify', async () => {
  const { leerSaldosParaRecarga } = await import('./proveedores');
  const [a, b] = await Promise.all([
    leerSaldosParaRecarga(),
    leerSaldosParaRecarga(),
  ]);
  expect(a).toBe(b);
  const calls = mock.fetch.mock.calls;
  expect(
    calls.every(
      ([url, init]) =>
        !url.includes('chat/completions') &&
        (!init.method || init.method === 'GET')
    )
  ).toBe(true);
  expect(calls.some(([url]) => url.includes('apify'))).toBe(false);
  expect(a.proveedores.find((p) => p.id === 'fish')).toMatchObject({
    saldo: 3.5,
    unidad: 'USD',
  });
  expect(a.proveedores.find((p) => p.id === 'groq')).toMatchObject({
    saldo: null,
    estado: 'desconocido',
  });
  expect(a.proveedores.find((p) => p.id === 'deepgram')).toMatchObject({
    saldo: null,
    estado: 'error',
  });
  expect(a.proveedores.find((p) => p.id === 'elevenlabs')).toMatchObject({
    saldo: null,
    estado: 'error',
  });
  await leerSaldosParaRecarga();
  expect(mock.fetch).toHaveBeenCalledTimes(calls.length);
});
it('does not interpret an unauthorized provider response as a zero balance', async () => {
  mock.fetch.mockResolvedValue(
    Response.json({ credit: 0, data: { available_credit: 0 } }, { status: 401 })
  );
  const { leerSaldosParaRecarga } = await import('./proveedores');
  const data = await leerSaldosParaRecarga();
  for (const id of ['fish', 'telnyx', 'elevenlabs'])
    expect(data.proveedores.find((p) => p.id === id)).toMatchObject({
      saldo: null,
      estado: 'error',
    });
});
it('binds a manual Gemini balance to the Google API key fallback actually used', async () => {
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GOOGLE_API_KEY', 'google-fallback');
  const { claveParaSaldo } = await import('./proveedores');
  expect(await claveParaSaldo('gemini')).toBe('google-fallback');
});
