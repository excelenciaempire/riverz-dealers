import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_OPTIONS } from '@/lib/supabase/server'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from '@/lib/i18n/config'
import { detectLocale } from '@/lib/i18n/detect'
import { canonicalizePath, localizePath } from '@/lib/i18n/routes'

// Per-request CSP nonce. Next.js 16 reads the `'nonce-…'` value out of
// the response's Content-Security-Policy header and stamps it onto the
// framework + page chunks + any `<Script nonce>` in the tree. The same
// nonce is forwarded to the page via the `x-nonce` request header so
// server components (layout.tsx) can mirror it onto their own inline
// scripts (the theme-boot tag).
//
// Dev keeps `'unsafe-eval'` because React's RSC stack reconstructs
// server stacks in the browser via `eval`. Prod ships without it.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  const directives = [
    "default-src 'self'",
    // object-src 'none' explícito: <object>/<embed> pueden cargar plugins
    // legacy que evaden 'self' y no están cubiertos por strict-dynamic.
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Any https image source. The inbox renders real email bodies in a
    // sandboxed (script-free) <iframe srcdoc>, which inherits THIS policy;
    // marketing/transactional mail pulls logos and hero images from
    // arbitrary CDNs, so they must be allowed or every email renders
    // broken. Images can't execute code, and scripts stay fully blocked
    // by script-src, so this doesn't widen the XSS surface.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com https://*.myshopify.com https://api.anthropic.com",
    // Superconductor's embedded live preview runs in a cross-origin iframe.
    isDev
      ? "frame-ancestors 'self' https://superconductor.com https://*.superconductor.com"
      : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ]
  return directives.join('; ')
}

// Attaches the CSP header to any response leaving the proxy. Other
// security headers (HSTS, X-Frame-Options, etc.) come from
// next.config.ts so they apply uniformly even to responses that bypass
// the proxy.
function applyCsp(response: NextResponse, nonce: string): NextResponse {
  response.headers.set('Content-Security-Policy', buildCsp(nonce))
  return response
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next 16 reads the CSP from the *request* headers to stamp the nonce
  // onto its framework + page chunks. Without this, all scripts ship with
  // nonce="" and the browser blocks every chunk → blank page.
  requestHeaders.set('Content-Security-Policy', csp)

  // Shopify post-install bootstrap. Custom-app distribution sends the
  // merchant to the App URL (not our redirect_uri) with `?shop=…&hmac=…`.
  // The merchant has no Riverz session, so this must run before the
  // demo/auth checks that would bounce them to /ingresar and drop the
  // query string. Forward to /api/shopify/oauth/start preserving the
  // params Shopify needs to keep the install flow signed.
  const shopParam = request.nextUrl.searchParams.get('shop')
  if (
    shopParam &&
    /^[\w-]+\.myshopify\.com$/i.test(shopParam) &&
    !request.nextUrl.pathname.startsWith('/api/shopify/')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/api/shopify/oauth/start'
    const next = new URLSearchParams()
    next.set('shop', shopParam)
    for (const key of ['host', 'hmac', 'timestamp', 'embedded', 'session']) {
      const value = request.nextUrl.searchParams.get(key)
      if (value) next.set(key, value)
    }
    url.search = `?${next.toString()}`
    return applyCsp(NextResponse.redirect(url), nonce)
  }

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS })
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // The browser URL may be in either language (e.g. /inbox or /bandeja).
  // Reason about routes in ONE vocabulary (canonical Spanish) for every
  // check, and send redirects to the user's locale so the address bar stays
  // in their language.
  const canonicalPath = canonicalizePath(request.nextUrl.pathname)
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
  const locale: Locale = isLocale(cookieLocale)
    ? cookieLocale
    : detectLocale(request.headers)
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = localizePath(path, locale)
    return applyCsp(NextResponse.redirect(url), nonce)
  }

  // Auth pages - redirect to dashboard if already logged in. /nueva-clave
  // and /verificar-email are excluded: the user IS signed in when they
  // land there (recovery session / unconfirmed session) and need to
  // complete the flow before reaching the panel.
  if (user && (
    canonicalPath === '/ingresar' ||
    canonicalPath === '/registro' ||
    canonicalPath === '/recuperar-clave'
  )) {
    return redirectTo('/panel')
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/panel', '/bandeja', '/contactos', '/campanas', '/automatizaciones', '/menus', '/ajustes']
  if (!user && protectedPaths.some(path => canonicalPath.startsWith(path))) {
    return redirectTo('/ingresar')
  }

  // Email verification gate. Signed-in users without a confirmed email
  // get held on /verificar-email until they click the link. Sign-out,
  // the verify page itself, and the auth callback stay reachable so the
  // user can complete the flow or leave.
  if (
    user &&
    !user.email_confirmed_at &&
    !user.confirmed_at &&
    canonicalPath !== '/verificar-email' &&
    canonicalPath !== '/auth/callback' &&
    !canonicalPath.startsWith('/api/auth/') &&
    protectedPaths.some(path => canonicalPath.startsWith(path))
  ) {
    return redirectTo('/verificar-email')
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return applyCsp(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), nonce)
  }

  // First-visit locale default: if no locale cookie yet, seed it from the
  // geo/Accept-Language headers ("por IP"). Not httpOnly — the client
  // LocaleProvider reads + overwrites it when the user picks a language.
  if (!request.cookies.get(LOCALE_COOKIE)) {
    supabaseResponse.cookies.set(LOCALE_COOKIE, detectLocale(request.headers), {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    })
  }

  return applyCsp(supabaseResponse, nonce)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
