import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { safeSecretEqual } from '@/lib/auth/cron';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { meteredAnthropicFetch } from '@/lib/ai/metered-fetch';
import { exigirMensualidad } from '@/lib/wallet/puerta';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  context: { params: Promise<{ callId: string }> }
) {
  if (
    !process.env.VOICE_WORKER_SECRET ||
    !safeSecretEqual(
      request.headers.get('x-api-key') ?? '',
      process.env.VOICE_WORKER_SECRET
    )
  )
    return new Response(null, { status: 401 });
  const { callId } = await context.params;
  const db = supabaseAdmin();
  const { data: call, error } = await db
    .from('voice_calls')
    .select('workspace_id,ended_at')
    .eq('id', callId)
    .maybeSingle();
  if (
    error ||
    !call ||
    (call.ended_at && Date.now() - Date.parse(call.ended_at) > 300000)
  )
    return new Response(null, { status: 404 });
  const paymentBlock = await exigirMensualidad(db, call.workspace_id);
  if (paymentBlock) return paymentBlock;
  const model = await getVoiceModelResolved(db);
  if (model.llm_provider !== 'anthropic' || model.llm_base_url)
    return new Response(null, { status: 503 });
  const key = model.llm_api_key
    ? { key: model.llm_api_key }
    : await resolveAnthropicKey(db, { workspaceId: call.workspace_id });
  if (!key) return new Response(null, { status: 503 });
  try {
    const response = await meteredAnthropicFetch({
      db,
      workspaceId: call.workspace_id,
      concepto: 'llamada_ia',
      detalle: { callId },
    })('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key.key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: await request.text(),
    });
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return new Response(null, { status: 402 });
  }
}
