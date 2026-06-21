/**
 * Single source of truth for the version of the legal documents
 * (Terms & Conditions + Privacy Policy) that a user consents to when
 * they create an account or accept a workspace invite.
 *
 * Stored verbatim on every consent record (see migration 085 →
 * `legal_consents.version` and `profiles.terms_version`) so each
 * acceptance points at the exact text that was in force.
 *
 * BUMP THIS whenever the substance of /terminos (`src/app/terminos`)
 * or /privacidad (`src/app/privacidad`) changes — it tracks the most
 * recent update to EITHER document — and keep it in sync with the
 * human-readable "Last updated" date rendered on those pages. Bumping
 * it lets us later require existing users to re-accept the new version.
 *
 * Format: ISO date (YYYY-MM-DD) of the update.
 */
export const LEGAL_VERSION = "2026-06-21";
