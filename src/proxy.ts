import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_OPTIONS } from '@/lib/supabase/server'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from '@/lib/i18n/config'
import { detectLocaleWithIp } from '@/lib/i18n/detect'
import { canonicalizePath, localizePath } from '@/lib/i18n/routes'
import { signupsOpenForInstall } from '@/lib/auth/signups'
import { adminLegacyRedirect, adminRewrite, isAdminHost, isAdminInternalPath, subdomainOnly } from '@/lib/admin/host'
import { docsHost, docsRedirect, docsRewrite, isDocsHost } from '@/lib/docs/host'
import { isBusinessMutation, workspaceReadOnly, BILLING_READ_ONLY } from '@/lib/billing/read-only'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { translate } from '@/lib/i18n/translate'

// Per-request CSP nonce. Next.js 16 reads the `'nonce-…'` value out of
// the response's Content-Security-Policy header and stamps it onto the
// framework + page chunks + any `<Script nonce>` in the tree. The same
// nonce is forwarded to the page via the `x-nonce` request header so
// server components (layout.tsx) can mirror it onto their own inline
// scripts (the theme-boot tag).
//
// Dev keeps `'unsafe-eval'` because React's RSC stack reconstructs
// server stacks in the browser via `eval`. Prod ships without it.
function buildCsp(
  nonce: string,
  opts?: {
    shopifyEmbedded?: { shop: string | null }
    /** Lista explícita de orígenes que pueden embeber esta ruta (chat web). */
    frameAncestors?: string
  },
): string {
  const isDev = process.env.NODE_ENV === 'development'
  // /shopify/embedded renders inside the Shopify admin iframe: allow that
  // ancestry (pinned to the requesting shop when known) and the App Bridge
  // CDN script. Every other route keeps frame-ancestors 'none'.
  const shopifyEmbedded = opts?.shopifyEmbedded
  const frameAncestors = opts?.frameAncestors
    ? `frame-ancestors ${opts.frameAncestors}`
    : shopifyEmbedded
    ? `frame-ancestors https://admin.shopify.com${
        shopifyEmbedded.shop
          ? ` https://${shopifyEmbedded.shop}`
          : ' https://*.myshopify.com'
      }`
    : isDev
      ? // Superconductor's embedded live preview runs in a cross-origin iframe.
        "frame-ancestors 'self' https://superconductor.com https://*.superconductor.com"
      : "frame-ancestors 'none'"
  const directives = [
    "default-src 'self'",
    // object-src 'none' explícito: <object>/<embed> pueden cargar plugins
    // legacy que evaden 'self' y no están cubiertos por strict-dynamic.
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}${shopifyEmbedded ? ' https://cdn.shopify.com' : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Any https image source. The inbox renders real email bodies in a
    // sandboxed (script-free) <iframe srcdoc>, which inherits THIS policy;
    // marketing/transactional mail pulls logos and hero images from
    // arbitrary CDNs, so they must be allowed or every email renders
    // broken. Images can't execute code, and scripts stay fully blocked
    // by script-src, so this doesn't widen the XSS surface.
    "img-src 'self' data: blob: https:",
    // Sin esta directiva, <audio>/<video> caen a default-src 'self' y el
    // navegador bloquea TODO el media entrante: las notas de voz y los
    // videos que ingestamos viven en Supabase Storage (otro origen), así
    // que el reproductor quedaba en 0:00 sin fuente. Mismo criterio que
    // img-src: el media no ejecuta código y script-src sigue cerrado.
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com https://*.myshopify.com https://api.anthropic.com${shopifyEmbedded ? ' https://cdn.shopify.com' : ''}`,
    frameAncestors,
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
function applyCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  // The Shopify embedded page must be frameable by the merchant's admin;
  // pin frame-ancestors to their shop when the query names one.
  const isShopifyEmbedded = request.nextUrl.pathname === '/shopify/embedded'
  const embeddedShopParam = request.nextUrl.searchParams.get('shop')
  const csp = buildCsp(
    nonce,
    isShopifyEmbedded
      ? {
          shopifyEmbedded: {
            shop:
              embeddedShopParam && /^[\w-]+\.myshopify\.com$/i.test(embeddedShopParam)
                ? embeddedShopParam.toLowerCase()
                : null,
          },
        }
      : undefined,
  )
  // El panel de plataforma vive en su propio host (admin.riverz.co): ahi la
  // raiz ES el panel. En el dominio del producto /admin sigue sirviendo hasta
  // que ADMIN_SUBDOMAIN_ONLY corte el camino viejo — cortarlo antes de que el
  // DNS propague dejaria al equipo sin panel.
  const host = request.headers.get('host')
  // La documentacion tambien vive en su propio host (docs.riverz.co). Va antes
  // del panel porque son hosts distintos y el orden solo importa para leerlo.
  if (isDocsHost(host)) {
    const target = docsRewrite(request.nextUrl.pathname)
    if (target) {
      const url = request.nextUrl.clone()
      url.pathname = target
      return NextResponse.rewrite(url)
    }
  } else if (host && !/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
    // En el dominio del producto la documentacion no se sirve, se redirige: dos
    // URLs con el mismo contenido se reparten el posicionamiento y hacen dudar
    // a quien comparte una. En local no, o no habria forma de verla sin DNS.
    const target = docsRedirect(request.nextUrl.pathname)
    if (target) {
      return NextResponse.redirect(
        new URL(target + request.nextUrl.search, `https://${docsHost()}`),
        308,
      )
    }
  }
  if (isAdminHost(host)) {
    // Una seccion retirada se redirige de verdad. Sin esto cae en el reescritor
    // de abajo, que manda al home lo que no reconoce: un enlace viejo aterrizaba
    // en el indice como si hubiera funcionado.
    const legacy = adminLegacyRedirect(request.nextUrl.pathname)
    if (legacy) {
      const url = request.nextUrl.clone()
      url.pathname = legacy
      return NextResponse.redirect(url, 308)
    }
    const target = adminRewrite(request.nextUrl.pathname)
    if (target) {
      const url = request.nextUrl.clone()
      url.pathname = target
      return NextResponse.rewrite(url)
    }
  } else if (
    subdomainOnly() &&
    (request.nextUrl.pathname === '/admin' || request.nextUrl.pathname.startsWith('/admin/'))
  ) {
    // 404 y no redirect: quien no sabe que el panel existe, no se entera.
    return new NextResponse(null, { status: 404 })
  }

  // Estas dos URLs son la selección explícita de idioma de la página de alta:
  // quien abre /create recibe inglés y quien abre /crear recibe español,
  // incluso si tenía guardado el otro idioma de una visita anterior.
  const creationLocale: Locale | null =
    request.nextUrl.pathname === '/create'
      ? 'en'
      : request.nextUrl.pathname === '/crear'
        ? 'es'
        : null
  if (creationLocale) request.cookies.set(LOCALE_COOKIE, creationLocale)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next 16 reads the CSP from the *request* headers to stamp the nonce
  // onto its framework + page chunks. Without this, all scripts ship with
  // nonce="" and the browser blocks every chunk → blank page.
  requestHeaders.set('Content-Security-Policy', csp)

  // Shopify App URL bootstrap. Shopify sends merchants to the App URL
  // (site root) with `?shop=…&hmac=…` in two situations, and the merchant
  // has no Riverz session in either, so this must run before the auth
  // checks that would bounce them to /ingresar and drop the query string:
  //
  //  - embedded=1 → the admin iframe is loading the app: serve the
  //    embedded App Bridge page.
  //  - otherwise  → top-level install/open: start OAuth immediately
  //    (App Store review requires auth before any interstitial page).
  // ONLY at the site root: the App URL is `https://riverz.co`, so this
  // bootstrap fires exclusively for `/?shop=…`. Matching every path would
  // catch our own post-auth redirects — `/crear?shop=…`,
  // `/integraciones?shop=…` — and bounce them back to OAuth, an infinite
  // redirect loop (the callback lands on `/crear?shopify=pending&shop=…`).
  const shopParam = request.nextUrl.searchParams.get('shop')
  if (
    request.nextUrl.pathname === '/' &&
    shopParam &&
    /^[\w-]+\.myshopify\.com$/i.test(shopParam)
  ) {
    const url = request.nextUrl.clone()
    const isEmbeddedLoad = request.nextUrl.searchParams.get('embedded') === '1'
    url.pathname = isEmbeddedLoad ? '/shopify/embedded' : '/api/shopify/oauth/start'
    // Forward the query VERBATIM: Shopify's hmac signs every param, so
    // dropping any of them would break downstream signature checks.
    // Chrome enforces frame-ancestors on redirect responses inside
    // iframes, so the embedded hop must already be frameable.
    const redirectCsp = isEmbeddedLoad
      ? buildCsp(nonce, { shopifyEmbedded: { shop: shopParam.toLowerCase() } })
      : csp
    return applyCsp(NextResponse.redirect(url), redirectCsp)
  }

  // Redirector público de short links (`/r/:token`). Es un endpoint sin sesión
  // que abre el cliente desde WhatsApp; saltamos la carga de sesión de Supabase
  // y la lógica de idioma para que la redirección sea rápida y no dependa de
  // cookies. La ruta resuelve el token y hace 302 al link real.
  if (request.nextUrl.pathname.startsWith('/r/')) {
    return applyCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp)
  }

  // Chat web. Nada de acá tiene sesión de Riverz: quien lo abre es un visitante
  // de la tienda del comercio, y la autorización la da el token del widget. Sin
  // este atajo cada mensaje escrito en el chat —y cada sondeo, que son varios
  // por minuto y por pestaña abierta— pagaría una verificación de sesión de
  // Supabase que siempre da vacío.
  //
  // La página del chat, además, se sirve DENTRO de un iframe en la tienda: el
  // `frame-ancestors 'none'` general la bloquearía. Se abre a cualquier sitio
  // https porque el control de quién puede embeberla no es el navegador sino el
  // token de sesión, que sólo se emite para los dominios que el comercio
  // autorizó.
  const webchatPath =
    request.nextUrl.pathname.startsWith('/widget/') ||
    request.nextUrl.pathname.startsWith('/api/widget/')
  if (webchatPath) {
    const widgetCsp = buildCsp(nonce, { frameAncestors: 'https: http://localhost:*' })
    requestHeaders.set('Content-Security-Policy', widgetCsp)
    return applyCsp(
      NextResponse.next({ request: { headers: requestHeaders } }),
      widgetCsp,
    )
  }

  // Seed the locale in the forwarded request as well as the response. A
  // response-only cookie takes effect on the *next* navigation, leaving the
  // first page rendered in the fallback language despite IP detection.
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
  const locale: Locale = creationLocale ?? (
    isLocale(cookieLocale) ? cookieLocale : await detectLocaleWithIp(request.headers)
  )
  const shouldSetLocaleCookie = creationLocale !== null || !isLocale(cookieLocale)
  if (shouldSetLocaleCookie) {
    request.cookies.set(LOCALE_COOKIE, locale)
    requestHeaders.set('cookie', request.cookies.toString())
  }

  const withLocaleCookie = (response: NextResponse) => {
    if (shouldSetLocaleCookie) {
      response.cookies.set(LOCALE_COOKIE, locale, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      })
    }
    return applyCsp(response, csp)
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
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = localizePath(path, locale)
    return withLocaleCookie(NextResponse.redirect(url))
  }

  // Con el alta cerrada a mano, la página de registro no se alcanza.
  // canonicalPath cubre /crear, su slug en inglés /create y los alias viejos
  // /registro y /signup. Quien entra sin sesión cae EN el formulario de la
  // lista de espera (#lista), no arriba de la portada, así que el que venía a
  // abrir cuenta igual queda anotado; con sesión, sigue al redirect a /panel.
  //
  // Hoy el alta está abierta y esto no dispara: la puerta es el código de
  // invitación, que se comprueba en `POST /api/auth/signup`.
  const puedeRegistrarse = signupsOpenForInstall(
    (nombre) => Boolean(request.cookies.get(nombre)?.value)
  )
  if (!user && !puedeRegistrarse && canonicalPath === '/crear') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    url.hash = 'lista'
    return withLocaleCookie(NextResponse.redirect(url))
  }

  // Auth pages - redirect to dashboard if already logged in. /nueva-clave
  // and /verificar-email are excluded: the user IS signed in when they
  // land there (recovery session / unconfirmed session) and need to
  // complete the flow before reaching the panel.
  if (user && (
    canonicalPath === '/ingresar' ||
    canonicalPath === '/crear' ||
    canonicalPath === '/recuperar-clave'
  )) {
    return redirectTo('/panel')
  }

  // Protected pages - redirect to login if not authenticated
  // Toda sección del panel, no solo algunas. Faltaban /voz, /asistente,
  // /comentarios, /plantillas, /agente-instagram, /productos, /pedidos,
  // /integraciones y /actividad: entrar sin sesión no mostraba datos (RLS los
  // tapa) pero tampoco mandaba a iniciar sesión, así que se veía un panel
  // vacío y roto en vez de la pantalla de login. Mover las campañas de voz a
  // /voz/campanas lo hizo visible.
  const protectedPaths = [
    '/chat',
    '/operacion',
    '/panel',
    '/bandeja',
    '/contactos',
    '/asistente',
    '/menus',
    '/comentarios',
    '/voz',
    '/chat-web',
    '/plantillas',
    '/campanas',
    '/automatizaciones',
    '/agente-instagram',
    '/productos',
    '/pedidos',
    '/actividad',
    '/integraciones',
    '/ajustes',
    '/admin',
  ]
  if (
    !user &&
    !isAdminInternalPath(host, request.nextUrl.pathname) &&
    protectedPaths.some(path => canonicalPath.startsWith(path))
  ) {
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
    return withLocaleCookie(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }

  if (user && isBusinessMutation(canonicalPath, request.method)) {
    try {
      const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
      if (workspaceId && await workspaceReadOnly(supabase, workspaceId)) {
        return withLocaleCookie(NextResponse.json({
          code: BILLING_READ_ONLY, error: translate(locale, 'settings.readOnlyBody'),
        }, { status: 402 }))
      }
    } catch {
      return withLocaleCookie(NextResponse.json({
        error: translate(locale, 'settings.billingStateUnavailable'),
      }, { status: 503 }))
    }
  }

  return withLocaleCookie(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
