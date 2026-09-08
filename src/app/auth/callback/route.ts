import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { canonicalizePath, localizePath } from "@/lib/i18n/routes";
import { publicBaseUrl } from "@/lib/base-url";

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
  // Keep the post-auth landing URL in the user's language.
  const locale = await getLocale();

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: SESSION_COOKIE_OPTIONS,
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS }),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const fail = new URL(publicBaseUrl());
      fail.pathname = localizePath("/ingresar", locale);
      fail.search = `?error=${encodeURIComponent(error.message)}`;
      return NextResponse.redirect(fail);
    }
  }

  // Render exposes its internal localhost origin in request.nextUrl.
  // Auth redirects must use the configured public origin instead.
  const dest = new URL(publicBaseUrl());
  dest.pathname = localizePath(canonicalizePath(safeNext), locale);
  dest.search = "";
  dest.hash = "";
  return NextResponse.redirect(dest);
}
