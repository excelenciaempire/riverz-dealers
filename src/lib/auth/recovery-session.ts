type RecoveryAuth = {
  getSession: () => Promise<{ data: { session: unknown | null } }>;
  setSession: (tokens: {
    access_token: string;
    refresh_token: string;
  }) => Promise<{ error: unknown | null }>;
  exchangeCodeForSession: (code: string) => Promise<{ error: unknown | null }>;
  verifyOtp: (input: {
    token_hash: string;
    type: "recovery";
  }) => Promise<{ error: unknown | null }>;
};

/** Establish the recovery session before rendering the password form.
 * Supabase may deliver recovery links as an implicit token fragment, a PKCE
 * code, or a token hash depending on the auth client and project settings. */
export async function restoreRecoverySession(
  auth: RecoveryAuth,
  href: string,
): Promise<boolean> {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  let error: unknown | null = null;

  if (accessToken && refreshToken) {
    ({ error } = await auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    }));
  } else {
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    if (code) ({ error } = await auth.exchangeCodeForSession(code));
    else if (tokenHash) ({ error } = await auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }));
  }

  if (error) return false;
  const { data } = await auth.getSession();
  return Boolean(data.session);
}
