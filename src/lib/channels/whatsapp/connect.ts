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
import { encrypt as encryptLegacy } from "@/lib/whatsapp/encryption";
import { resolveWorkspaceOwnerUserId } from "@/lib/workspaces/owner";

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
  /** Meta's phone platform_type (e.g. CLOUD_API, BUSINESS_APP) — persisted for
   *  diagnostics; coexistence numbers report the business-app platform. */
  platformType?: string;
  onboarding: "embedded_signup" | "embedded_signup_coexistence" | "manual";
  /** PIN de dos pasos con el que se registra el número propio. Se guarda
   *  cifrado para poder volver a registrarlo sin pedírselo al comercio. */
  registerPin?: string;
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
    .select("id, status, external_account_id, label, config, secrets")
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
  // Keep metadata across reconnects only for the same WhatsApp account.
  const previous = existing.find((r) =>
    r.external_account_id === args.phoneNumberId && r.config?.waba_id === args.wabaId
  )?.config ?? {};
  let businessId: string | undefined;
  try {
    const url = new URL(`https://graph.facebook.com/v25.0/${args.wabaId}`);
    url.searchParams.set('fields', 'owner_business_info');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const body = await response.json();
      const id = body.owner_business_info?.id;
      if (typeof id === 'string' && /^\d+$/.test(id)) businessId = id;
    }
  } catch {
    // Missing billing metadata must not prevent messaging from connecting.
  }
  const config = {
    ...previous,
    ...(businessId ? { business_id: businessId } : {}),
    phone_number_id: args.phoneNumberId,
    waba_id: args.wabaId,
    display_phone_number: args.displayPhoneNumber,
    verified_name: args.verifiedName,
    coexistence: Boolean(args.coexistence),
    platform_type: args.platformType,
    onboarding: args.onboarding,
    // Abre la ventana de 24 h en que Meta acepta pedir el historial de
    // coexistencia (history-sync.ts).
    connected_at: new Date().toISOString(),
  };
  const pinAnterior = (existing.find((r) => r.external_account_id === args.phoneNumberId)
    ?.secrets as Record<string, unknown> | null)?.register_pin;
  const secrets: Record<string, unknown> = { access_token: encrypt(args.token) };
  if (args.registerPin) secrets.register_pin = encrypt(args.registerPin);
  else if (typeof pinAnterior === "string") secrets.register_pin = pinAnterior;

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

/**
 * Bridge the WhatsApp connection into the LEGACY `whatsapp_config` table.
 *
 * The unified inbox sends through `channel_connections` (above), but the
 * automations engine, flow engine, template sync/create, broadcasts and the
 * AI agents all still read WhatsApp credentials from the per-user
 * `whatsapp_config` table — keyed on the WORKSPACE OWNER's `user_id` (via
 * `resolveWorkspaceOwnerUserId`). Without this bridge, connecting WhatsApp
 * lights up the inbox but leaves every one of those features with no number
 * to send through. So on every WhatsApp connect we mirror the creds here too.
 *
 * Best-effort: a failure here is logged, never blocks the primary connect.
 * Note the separate `@/lib/whatsapp/encryption` key — this table predates the
 * channels encryption and the send paths decrypt with the legacy key.
 */
export async function syncLegacyWhatsAppConfig(
  admin: SupabaseClient,
  args: { workspaceId: string; phoneNumberId: string; wabaId: string; token: string },
): Promise<void> {
  try {
    const ownerId = await resolveWorkspaceOwnerUserId(admin, args.workspaceId);
    if (!ownerId) {
      console.warn("[whatsapp] legacy config sync: no workspace owner", args.workspaceId);
      return;
    }
    // The legacy inbound webhook (/api/whatsapp/webhook) verifies Meta's GET
    // handshake by matching hub.verify_token against this row's verify_token
    // (per-config, NOT a global env token). Seed it with META_WEBHOOK_VERIFY_TOKEN
    // so the operator pastes that one value in Meta and the handshake passes.
    const verifyTokenPlain = process.env.META_WEBHOOK_VERIFY_TOKEN;
    const row: Record<string, unknown> = {
      phone_number_id: args.phoneNumberId,
      waba_id: args.wabaId,
      access_token: encryptLegacy(args.token),
      status: "connected",
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      workspace_id: args.workspaceId,
    };
    if (verifyTokenPlain) row.verify_token = encryptLegacy(verifyTokenPlain);
    // Una fila por comercio (migración 284). Antes era una por dueño, y un
    // dueño con dos comercios pisaba el número del primero con el del segundo.
    // El número solo puede vivir en un comercio: si estaba en otro, se va de ahí.
    await admin
      .from("whatsapp_config")
      .delete()
      .eq("phone_number_id", args.phoneNumberId)
      .neq("workspace_id", args.workspaceId);
    const { data: existing } = await admin
      .from("whatsapp_config")
      .select("id")
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (existing) {
      await admin.from("whatsapp_config").update({ user_id: ownerId, ...row }).eq("id", existing.id);
    } else {
      await admin.from("whatsapp_config").insert({ user_id: ownerId, ...row });
    }
  } catch (err) {
    console.warn("[whatsapp] legacy config sync failed:", err);
  }
}
