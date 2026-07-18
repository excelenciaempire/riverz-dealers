import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel } from "@/types";

export interface ConnectionRowInput {
  workspace_id: string;
  channel: Channel;
  label: string;
  external_account_id: string;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  created_by: string;
}

export interface UpsertConnectionResult {
  id: string | null;
  /** true when an existing row was refreshed instead of inserting. */
  revived: boolean;
  error?: string;
}

/**
 * Insert-or-revive a channel connection: one ACTIVE row per
 * (workspace, channel, external account) — the contract
 * `uq_active_connection_per_account` (migration 098) enforces.
 *
 * A reconnect of the same account refreshes the existing row in place
 * (fresh tokens/config, status back to connected) instead of stacking a
 * duplicate the webhook router would then pick between arbitrarily.
 * Secrets/config are MERGED over the old values so a provider that only
 * returns e.g. a refresh_token on first consent doesn't lose it.
 */
export async function upsertConnectionRow(
  admin: SupabaseClient,
  row: ConnectionRowInput,
): Promise<UpsertConnectionResult> {
  const revived = await reviveExisting(admin, row);
  if (revived) return revived;

  const { data, error } = await admin
    .from("channel_connections")
    .insert({ ...row, status: "connected" })
    .select("id")
    .maybeSingle();
  if (!error) {
    return { id: (data as { id: string } | null)?.id ?? null, revived: false };
  }
  if (error.code === "23505") {
    // Race: another request inserted between our select and insert (or a
    // channel-specific cap like one-WhatsApp-per-workspace fired). Retry
    // as a refresh; if no row matches this identity, surface the error.
    const retried = await reviveExisting(admin, row);
    if (retried) return retried;
  }
  return { id: null, revived: false, error: error.message };
}

async function reviveExisting(
  admin: SupabaseClient,
  row: ConnectionRowInput,
): Promise<UpsertConnectionResult | null> {
  const { data } = await admin
    .from("channel_connections")
    .select("id, status, config, secrets")
    .eq("workspace_id", row.workspace_id)
    .eq("channel", row.channel)
    .eq("external_account_id", row.external_account_id)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []) as Array<{
    id: string;
    status: string;
    config: Record<string, unknown> | null;
    secrets: Record<string, unknown> | null;
  }>;
  // Preferir la fila ACTIVA (la que ya satisface el índice único parcial
  // `uq_active_connection_per_account`), no la más reciente por updated_at.
  // La migración 098 degradó los duplicados a status='disconnected' Y les
  // puso updated_at=now(), así que "el más nuevo" pasó a ser justo el
  // duplicado desconectado: revivirlo (status→connected) chocaría con la
  // fila activa superviviente bajo el índice → 23505 y la reconexión fallaba.
  const existing = rows.find((r) => r.status !== "disconnected") ?? rows[0] ?? null;
  if (!existing) return null;

  const { error } = await admin
    .from("channel_connections")
    .update({
      label: row.label,
      status: "connected",
      last_error: null,
      config: { ...(existing.config ?? {}), ...row.config },
      secrets: { ...(existing.secrets ?? {}), ...row.secrets },
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) return { id: null, revived: true, error: error.message };
  return { id: existing.id, revived: true };
}
