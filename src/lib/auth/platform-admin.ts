/**
 * Platform (super) admin gate — distinct from a workspace admin.
 *
 * A platform admin is the Riverz owner: they can change global settings that
 * affect every tenant (e.g. the voice model stack). Gated by an allowlist of
 * emails from `PLATFORM_ADMIN_EMAILS` (comma-separated), falling back to the
 * known owner so the surface works out of the box. The client mirror uses
 * `NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS` only to show/hide the nav entry — the
 * server API is the real gate.
 */

const FALLBACK_ADMINS = ['riverzoficial@gmail.com'];

function parseList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const allow = parseList(process.env.PLATFORM_ADMIN_EMAILS);
  const list = allow.length > 0 ? allow : FALLBACK_ADMINS;
  return list.includes(e);
}

/** Client-side mirror (nav visibility only; never a security boundary). */
export function isPlatformAdminClient(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const allow = parseList(process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS);
  const list = allow.length > 0 ? allow : FALLBACK_ADMINS;
  return list.includes(e);
}
