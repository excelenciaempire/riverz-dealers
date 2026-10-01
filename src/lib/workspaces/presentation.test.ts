import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PRESENTATION_WORKSPACE_ID,
  isPresentationWorkspace,
} from './presentation';
import { motorApagado, estadoDelMotor } from './motor';
import { resolveAnthropicKey } from '../ai/platform-key';
import { reservar, liquidar, cancelar } from '../wallet/operacion';

describe('isolated presentation account', () => {
  it('only matches the server-owned account ID', () => {
    expect(isPresentationWorkspace(PRESENTATION_WORKSPACE_ID)).toBe(true);
    for (const id of [
      null,
      undefined,
      '',
      'live-store',
      `${PRESENTATION_WORKSPACE_ID}x`,
    ])
      expect(isPresentationWorkspace(id)).toBe(false);
  });

  it('blocks execution even with the visible motor configured on and DB unavailable', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('unavailable');
      }),
    } as unknown as SupabaseClient;
    expect(await motorApagado(db, PRESENTATION_WORKSPACE_ID)).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
    expect(
      await resolveAnthropicKey(db, {
        workspaceId: PRESENTATION_WORKSPACE_ID,
        agentKeyEncrypted: 'must-not-be-decrypted',
      })
    ).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('keeps the normal motor status and execution behavior for live stores', async () => {
    const row = { suspended_at: null, motor_apagado_at: null };
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row }),
          }),
        }),
      })),
    } as unknown as SupabaseClient;
    expect(await estadoDelMotor(db, PRESENTATION_WORKSPACE_ID)).toEqual({
      apagado: false,
      suspendida: false,
      esperandoAprobacion: false,
    });
    expect(await motorApagado(db, 'live-store')).toBe(false);
    row.motor_apagado_at = '2026-09-30' as never;
    expect(await motorApagado(db, 'live-store')).toBe(true);
  });

  it('never reserves or debits a presentation wallet', async () => {
    const rpc = vi.fn();
    const ctx = {
      db: { rpc } as unknown as SupabaseClient,
      workspaceId: PRESENTATION_WORKSPACE_ID,
      concepto: 'ia_respuesta',
    };
    await expect(reservar(ctx, 'anthropic', 1)).rejects.toThrow(
      'presentation_provider_disabled'
    );
    expect(await liquidar(ctx, 'operation', 'anthropic', 1)).toBeNull();
    await cancelar(ctx, 'operation');
    expect(rpc).not.toHaveBeenCalled();
  });
});
