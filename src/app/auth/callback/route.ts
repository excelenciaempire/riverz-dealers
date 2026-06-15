import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase password-recovery + email-confirmation redirect target.
 *
 * Old (implicit) flow lands with `#access_token=...&type=recovery` in
 * the URL fragment, which only the browser can see — for that we just
 * pass through to `next` and let the destination page read the hash.
 * New (PKCE) flow lands with `?code=...` here, which we exchange for a
 * server-side session before forwarding the user along.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/panel";
  const safeNext = next.startsWith("/") ? next : "/panel";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const fail = url.clone();
      fail.pathname = "/ingresar";
      fail.search = `?error=${encodeURIComponent(error.message)}`;
      return NextResponse.redirect(fail);
    }
  }

  const dest = url.clone();
  dest.pathname = safeNext;
  dest.search = "";
  dest.hash = "";
  return NextResponse.redirect(dest);
}
