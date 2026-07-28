/**
 * Panel de infraestructura (admin) — estado + saldo EN VIVO de todo lo conectado.
 *
 * Consulta cada servicio del lado del servidor (usa las keys del entorno del CRM)
 * y devuelve una lista normalizada. Cada fetch es FAIL-SOFT: nunca lanza; si algo
 * falla devuelve status 'error'/'unknown' con un detalle. Se corren en paralelo.
 *
 * Solo lectura. Ruta admin: /api/admin/infrastructure (platform-admin).
 */

export type SvcStatus = 'ok' | 'low' | 'empty' | 'error' | 'not_connected';
export type SvcCategory = 'llm' | 'voice' | 'infra' | 'messaging';

export interface ServiceHealth {
  id: string;
  name: string;
  category: SvcCategory;
  status: SvcStatus;
  /** Saldo/uso numérico si el proveedor lo expone. */
  balance?: number | null;
  unit?: string;
  /** Nota corta para la UI (idioma-neutro; la UI traduce los estados). */
  detail?: string;
}

const TIMEOUT_MS = 8000;

/** fetch con timeout; nunca lanza por timeout (devuelve el error para el caller). */
async function tfetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

// ─────────────────────────── Saldos con monto real ───────────────────────────

async function telnyx(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'telnyx', name: 'Telnyx', category: 'voice', status: 'error' };
  const key = process.env.TELNYX_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch('https://api.telnyx.com/v2/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const j = await r.json();
    const b = j?.data;
    if (!b) return { ...base, detail: 'sin datos' };
    const credit = Number(b.available_credit ?? b.balance ?? 0);
    return {
      ...base,
      status: credit <= 0 ? 'empty' : credit < 10 ? 'low' : 'ok',
      balance: credit,
      unit: b.currency || 'USD',
      detail: 'telefonía',
    };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function deepgram(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'deepgram', name: 'Deepgram', category: 'voice', status: 'error' };
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const pr = await tfetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${key}` },
    });
    const pj = await pr.json();
    const pid = pj?.projects?.[0]?.project_id;
    if (!pid) return { ...base, detail: 'sin proyecto' };
    const br = await tfetch(`https://api.deepgram.com/v1/projects/${pid}/balances`, {
      headers: { Authorization: `Token ${key}` },
    });
    const bj = await br.json();
    const amount = Number(bj?.balances?.[0]?.amount ?? 0);
    return {
      ...base,
      status: amount <= 0 ? 'empty' : amount < 15 ? 'low' : 'ok',
      balance: amount,
      unit: 'USD',
      detail: 'STT + voz Celeste',
    };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function fish(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'fish', name: 'Fish Audio', category: 'voice', status: 'error' };
  const key = process.env.FISH_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch('https://api.fish.audio/wallet/self/api-credit', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const j = await r.json();
    // `credit` viene como string en la API de Fish.
    const credit = Number(j?.credit ?? 0);
    return {
      ...base,
      status: credit <= 0 ? 'empty' : credit < 5 ? 'low' : 'ok',
      balance: credit,
      unit: 'USD',
      detail: 'TTS S2.1',
    };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function elevenlabs(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'elevenlabs', name: 'ElevenLabs', category: 'voice', status: 'error' };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
    });
    const j = await r.json();
    const remaining = Number(j?.character_limit ?? 0) - Number(j?.character_count ?? 0);
    return {
      ...base,
      status: remaining <= 0 ? 'empty' : remaining < 5000 ? 'low' : 'ok',
      balance: remaining,
      unit: 'chars',
      detail: 'voz premium (no en uso)',
    };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

// ─────────────────────────────── LLMs (estado) ───────────────────────────────

/** Probe mínimo OpenAI-compatible (max_tokens 1). 200=ok, 402=empty, else error. */
async function probeOpenAICompat(
  id: string,
  name: string,
  baseUrl: string,
  key: string | undefined,
  model: string,
  detail: string,
): Promise<ServiceHealth> {
  const base: ServiceHealth = { id, name, category: 'llm', status: 'error', detail };
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (r.status === 200) return { ...base, status: 'ok' };
    if (r.status === 402 || r.status === 429) return { ...base, status: r.status === 402 ? 'empty' : 'low', detail: r.status === 429 ? 'límite de uso' : 'sin saldo' };
    return { ...base, detail: `HTTP ${r.status}` };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function anthropic(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'anthropic', name: 'Anthropic (Claude)', category: 'llm', status: 'error', detail: 'bot de texto + investigación' };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (r.status === 200) return { ...base, status: 'ok' };
    const j = await r.json().catch(() => null);
    const msg = String(j?.error?.message || '');
    if (/credit balance/i.test(msg)) return { ...base, status: 'empty', detail: 'sin saldo' };
    return { ...base, detail: `HTTP ${r.status}` };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function gemini(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'gemini', name: 'Google (Gemini)', category: 'llm', status: 'error' };
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    return { ...base, status: r.status === 200 ? 'ok' : 'error', detail: r.status === 200 ? 'activo' : `HTTP ${r.status}` };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

// ────────────────────────────── Infraestructura ──────────────────────────────

async function render(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'render', name: 'Render (hosting)', category: 'infra', status: 'error' };
  const key = process.env.RENDER_API_KEY;
  if (!key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch('https://api.render.com/v1/services?limit=100', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const a = (await r.json()) as Array<{ service?: { suspended?: string } } & { suspended?: string }>;
    const svcs = a.map((x) => x.service || x);
    const total = svcs.length;
    const suspended = svcs.filter((s) => (s as { suspended?: string }).suspended === 'suspended').length;
    return {
      ...base,
      status: suspended > 0 ? 'low' : 'ok',
      balance: total - suspended,
      unit: `/${total} activos`,
      detail: suspended > 0 ? `${suspended} suspendidos` : 'todos activos',
    };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function supabase(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'supabase', name: 'Supabase (DB + storage)', category: 'infra', status: 'error' };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ...base, status: 'not_connected' };
  try {
    const r = await tfetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return { ...base, status: r.ok ? 'ok' : 'error', detail: r.ok ? 'operativo' : `HTTP ${r.status}` };
  } catch {
    return { ...base, detail: 'no responde' };
  }
}

async function livekit(): Promise<ServiceHealth> {
  const base: ServiceHealth = { id: 'livekit', name: 'LiveKit (voz)', category: 'infra', status: 'error' };
  const url = process.env.LIVEKIT_URL;
  const ok_ = url && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET;
  if (!ok_) return { ...base, status: 'not_connected' };
  // El SDK server firma tokens localmente; con las 3 vars presentes está operativo.
  return { ...base, status: 'ok', detail: 'orquestación de llamadas' };
}

/** Corre todos los checks en paralelo y devuelve la lista + timestamp. */
export async function getInfrastructureStatus(): Promise<{
  services: ServiceHealth[];
  checkedAt: string;
}> {
  const results = await Promise.allSettled([
    // LLMs
    anthropic(),
    probeOpenAICompat('cerebras', 'Cerebras', 'https://api.cerebras.ai/v1', process.env.CEREBRAS_API_KEY, 'gpt-oss-120b', 'LLM de voz (rápido)'),
    probeOpenAICompat('groq', 'Groq', 'https://api.groq.com/openai/v1', process.env.GROQ_API_KEY, 'llama-3.1-8b-instant', 'LLM backup'),
    gemini(),
    probeOpenAICompat('openai', 'OpenAI', 'https://api.openai.com/v1', process.env.OPENAI_API_KEY, 'gpt-4o-mini', 'GPT'),
    // Voz / telefonía (con saldo)
    telnyx(),
    deepgram(),
    fish(),
    elevenlabs(),
    // Infra
    render(),
    supabase(),
    livekit(),
  ]);
  const services = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : ({ id: 'unknown', name: '—', category: 'infra', status: 'error', detail: 'error' } as ServiceHealth),
  );
  return { services, checkedAt: new Date().toISOString() };
}
