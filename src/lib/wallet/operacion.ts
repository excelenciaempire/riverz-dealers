import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPresentationWorkspace } from '@/lib/workspaces/presentation';

export interface BillingContext {
  db: SupabaseClient;
  workspaceId: string;
  concepto: string;
  detalle?: Record<string, unknown>;
  origenDeLaClave?: string;
}

export async function reservar(
  ctx: BillingContext,
  proveedor: string,
  maxUsd: number,
  detalle: Record<string, unknown> = {},
  operationId?: string
) {
  if (isPresentationWorkspace(ctx.workspaceId))
    throw new Error('presentation_provider_disabled');
  if (!ctx.workspaceId || !Number.isFinite(maxUsd) || maxUsd <= 0)
    throw new Error('wallet_invalid_reservation');
  const id = operationId ?? randomUUID();
  const { data, error } = await ctx.db.rpc('wallet_reservar', {
    p_workspace: ctx.workspaceId,
    p_id: id,
    p_concepto: ctx.concepto,
    p_proveedor: proveedor,
    p_centavos: Math.max(1, Math.ceil(maxUsd * 100)),
    p_detalle: { ...ctx.detalle, ...detalle },
  });
  if (error) throw new Error(`wallet_reservation_failed: ${error.message}`);
  if (data !== true) throw new Error('sin_saldo');
  return id;
}

export async function liquidar(
  ctx: BillingContext,
  id: string,
  proveedor: string,
  usd: number,
  detalle: Record<string, unknown> = {},
  cantidad = 1
) {
  if (isPresentationWorkspace(ctx.workspaceId)) return null;
  if (!Number.isFinite(usd) || usd < 0) throw new Error('wallet_invalid_cost');
  // A lost response can be retried safely: the operation ID is unique in PostgreSQL.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await ctx.db.rpc('wallet_liquidar', {
      p_workspace: ctx.workspaceId,
      p_id: id,
      p_concepto: ctx.concepto,
      p_proveedor: proveedor,
      p_costo_centavos: Math.round(usd * 100 * 1e8) / 1e8,
      p_cantidad: cantidad,
      p_detalle: { ...ctx.detalle, ...detalle },
    });
    if (!error) return data;
    lastError = error.message;
  }
  console.error('[wallet] unsettled usage', {
    id,
    workspaceId: ctx.workspaceId,
    proveedor,
    usd,
    detalle,
    lastError,
  });
  throw new Error(`wallet_settlement_failed: ${String(lastError)}`);
}

export async function cancelar(ctx: BillingContext, id: string) {
  if (isPresentationWorkspace(ctx.workspaceId)) return;
  const { error } = await ctx.db.rpc('wallet_cancelar_reserva', {
    p_workspace: ctx.workspaceId,
    p_id: id,
  });
  if (error) throw new Error(`wallet_release_failed: ${error.message}`);
}
