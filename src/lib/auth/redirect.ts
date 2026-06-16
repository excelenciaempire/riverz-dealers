/**
 * Sanitize a caller-supplied `redirect_to` against the app's own origin
 * before forwarding to Supabase Auth.
 *
 * Supabase enforces a project-level allowlist as a backstop, but
 * relying on that alone leaves us open to misconfiguration: any URL
 * matching a permissive pattern would slip through into the email body.
 * This helper coerces anything that doesn't match the configured site
 * origin to `undefined`, so Supabase falls back to its project-default
 * Site URL and legitimate flows still work.
 */
export function safeRedirectTo(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return undefined;
  try {
    const target = new URL(input, base);
    const allowed = new URL(base);
    return target.origin === allowed.origin ? target.toString() : undefined;
  } catch {
    return undefined;
  }
}
