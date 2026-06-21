import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/rate-limit";
import { getLogger } from "@/lib/log/logger";
import { LEGAL_VERSION } from "@/lib/legal/version";

const log = getLogger("legal.consent");

interface RecordConsentArgs {
  /** Service-role client (RLS-bypassing) — only the server may write. */
  admin: SupabaseClient;
  /** auth.users id of the consenting user. */
  userId: string;
  /** Email on record at acceptance time (lowercased/trimmed by caller). */
  email: string;
  /** Version string the user accepted; defaults to the current docs. */
  version?: string | null;
  /** Where the acceptance happened. */
  context: "signup" | "invite";
  /** The incoming request — used to capture IP + user-agent for proof. */
  req: Request;
}

/**
 * Persists a single Terms & Privacy acceptance event.
 *
 * Writes the authoritative append-only audit row (`legal_consents`) and
 * mirrors the latest acceptance onto the profile (`terms_accepted_at` /
 * `terms_version`) for fast gating. Both run through the service-role
 * client because users have no write policy on `legal_consents` (so the
 * record can't be forged or erased) and the profile write happens
 * outside an authenticated session at signup time.
 *
 * Best-effort by design: this is called after the account/membership
 * has already been created, so a storage hiccup is logged but never
 * surfaced as a user-facing failure. The UI still gates on an explicit
 * checkbox and the API still rejects requests without acceptance, so a
 * missed audit row degrades proof — it never lets an un-consented user
 * through.
 */
export async function recordLegalConsent({
  admin,
  userId,
  email,
  version,
  context,
  req,
}: RecordConsentArgs): Promise<void> {
  const acceptedVersion = version?.trim() || LEGAL_VERSION;
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent")?.slice(0, 1024) ?? null;
  const acceptedAt = new Date().toISOString();

  try {
    const { error } = await admin.from("legal_consents").insert({
      user_id: userId,
      email,
      document: "terms_and_privacy",
      version: acceptedVersion,
      context,
      ip,
      user_agent: userAgent,
      accepted_at: acceptedAt,
    });
    if (error) {
      log.error("legal_consents insert failed", {
        user_id: userId,
        context,
        error: error.message,
      });
    }
  } catch (e) {
    log.error("legal_consents insert threw", {
      user_id: userId,
      context,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await admin
      .from("profiles")
      .update({
        terms_accepted_at: acceptedAt,
        terms_version: acceptedVersion,
      })
      .eq("user_id", userId);
  } catch (e) {
    log.warn("profile terms mirror update failed", {
      user_id: userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
