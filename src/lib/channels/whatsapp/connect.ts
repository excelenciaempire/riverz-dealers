/**
 * Single source of truth for persisting a WhatsApp connection.
 *
 * Product rule: one WhatsApp number per workspace. A workspace maps to
 * one business (one WABA on our plan), and coexistence is still a single
 * number (is_on_biz_app=true), so this rule is forward-compatible with
 * the future coexistence work.
 *
 * Behaviour:
 *   - No active WhatsApp yet            → insert.
 *   - Same number reconnecting          → update the existing row in
 *                                         place (refresh token/config/
 *                                         label, clear last_error).
 *   - A DIFFERENT number while one is
 *     active (status <> 'disconnected') → throw
 *                                         WhatsAppAlreadyConnectedError
 *                                         so callers return a 409 telling
 *                                         the admin to disconnect first.
 *
 * The partial unique index `uq_one_active_whatsapp_per_workspace`
 * (migration 063) is the race-safe backstop; this helper is the primary
 * guard with a human-readable message.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/channels/encryption";

/** Thrown when a workspace already has a different active WhatsApp. */
export class WhatsAppAlreadyConnectedError extends Error {
  constructor(public readonly existingLabel: string) {
    super("workspace already has an active WhatsApp connection");
    this.name = "WhatsAppAlreadyConnectedError";
  }
}

export interface UpsertWhatsAppArgs {
  workspaceId: string;
  userId: string;
  /** Plaintext token — encrypted before persisting. */
  token: string;
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  coexistence?: boolean;
  onboarding: "embedded_signup" | "manual";
}

export interface UpsertWhatsAppResult {
  connectionId: string;
  label: string;
}

function buildLabel(args: UpsertWhatsAppArgs): string {
  return args.verifiedName
    ? `${args.verifiedName} (${args.displayPhoneNumber ?? ""})`.trim()
    : `WhatsApp ${args.phoneNumberId}`;
}

export async function upsertSingleWhatsAppConnection(
  admin: SupabaseClient,
  args: UpsertWhatsAppArgs,
): Promise<UpsertWhatsAppResult> {
  const { data: rows, error: selErr } = await admin
    .from("channel_connections")
    .select("id, status, external_account_id, label")
    .eq("workspace_id", args.workspaceId)
    .eq("channel", "whatsapp");
  if (selErr) throw new Error(`lookup failed: ${selErr.message}`);

  const existing = rows ?? [];
  // An active connection occupies the single WhatsApp slot. A different
  // number can't take it until the current one is disconnected.
  const active = existing.find((r) => r.status !== "disconnected");
  if (active && active.external_account_id !== args.phoneNumberId) {
    throw new WhatsAppAlreadyConnectedError(
      (active.label as string | null) ??
        (active.external_account_id as string | null) ??
        "WhatsApp",
    );
  }

  const label = buildLabel(args);
  const config = {
    phone_number_id: args.phoneNumberId,
    waba_id: args.wabaId,
    display_phone_number: args.displayPhoneNumber,
    verified_name: args.verifiedName,
    coexistence: Boolean(args.coexistence),
    onboarding: args.onboarding,
  };
  const secrets = { access_token: encrypt(args.token) };

  // Reuse the row for this exact number (any status) so reconnecting —
  // or reactivating a previously disconnected number — updates in place
  // instead of leaving a stale duplicate.
  const sameNumber = existing.find(
    (r) => r.external_account_id === args.phoneNumberId,
  );
  if (sameNumber) {
    const { data, error } = await admin
      .from("channel_connections")
      .update({ label, status: "connected", config, secrets, last_error: null })
      .eq("id", sameNumber.id as string)
      .select("id")
      .single();
    if (error) throw new Error(`update failed: ${error.message}`);
    return { connectionId: data.id as string, label };
  }

  const { data, error } = await admin
    .from("channel_connections")
    .insert({
      workspace_id: args.workspaceId,
      channel: "whatsapp",
      label,
      status: "connected",
      external_account_id: args.phoneNumberId,
      config,
      secrets,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error) {
    // Backstop: the partial unique index tripped on a concurrent connect.
    if (error.code === "23505") {
      throw new WhatsAppAlreadyConnectedError("WhatsApp");
    }
    throw new Error(`insert failed: ${error.message}`);
  }
  return { connectionId: data.id as string, label };
}
