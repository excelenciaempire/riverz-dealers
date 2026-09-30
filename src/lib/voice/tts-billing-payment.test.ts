import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ gate: vi.fn(), reserve: vi.fn(), settle: vi.fn(), transport: vi.fn() }));
vi.mock('@/lib/wallet/puerta', () => ({ exigirMensualidad: m.gate }));
vi.mock('@/lib/wallet/operacion', () => ({ reservar: m.reserve, liquidar: m.settle, cancelar: vi.fn() }));
import { synthesizeBilled } from './tts-billing';
it('does not synthesize or debit overdue monthly debt and resumes without resetting the wallet', async () => {
  vi.stubGlobal('fetch', m.transport);
  try {
    const ctx = { db: {} as SupabaseClient, workspaceId: 'ws', concepto: 'voz_tts' };
    const opts = { provider: 'fish', key: 'test', model: 's2', voice: 'voice', text: 'hello' };
    m.gate.mockResolvedValueOnce(new Response(null, { status: 402 })).mockResolvedValue(null);
    await expect(synthesizeBilled(ctx, opts)).rejects.toThrow('suscripcion_vencida');
    expect(m.reserve).not.toHaveBeenCalled(); expect(m.transport).not.toHaveBeenCalled();
    m.reserve.mockResolvedValue('hold'); m.transport.mockResolvedValue(new Response('audio'));
    await synthesizeBilled(ctx, opts);
    expect(m.transport).toHaveBeenCalledTimes(1); expect(m.settle).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
