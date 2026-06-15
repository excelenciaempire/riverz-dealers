import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isDemoMode } from '@/lib/demo'

export async function middleware(request: NextRequest) {
  // Demo mode: act as if the user is already signed in. Bypasses the
  // entire auth check so the inbox is reachable without a Supabase
  // project. The dashboard then loads its data from the mock client.
  // The helper hard-disables demo in production regardless of env value.
  if (isDemoMode()) {
    if (
      request.nextUrl.pathname === '/ingresar' ||
      request.nextUrl.pathname === '/registro' ||
      request.nextUrl.pathname === '/recuperar-clave' ||
      request.nextUrl.pathname === '/nueva-clave'
    ) {
      const url = request.nextUrl.clone()
      url.pathname = '/panel'
      return NextResponse.redirect(url)
    }
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Auth pages - redirect to dashboard if already logged in. /nueva-clave
  // and /verificar-email are excluded: the user IS signed in when they
  // land there (recovery session / unconfirmed session) and need to
  // complete the flow before reaching the panel.
  if (user && (
    request.nextUrl.pathname === '/ingresar' ||
    request.nextUrl.pathname === '/registro' ||
    request.nextUrl.pathname === '/recuperar-clave'
  )) {
    const url = request.nextUrl.clone()
    url.pathname = '/panel'
    return NextResponse.redirect(url)
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/panel', '/bandeja', '/contactos', '/campanas', '/automatizaciones', '/menus', '/ajustes']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/ingresar'
    return NextResponse.redirect(url)
  }

  // Email verification gate. Signed-in users without a confirmed email
  // get held on /verificar-email until they click the link. Sign-out,
  // the verify page itself, and the auth callback stay reachable so the
  // user can complete the flow or leave.
  if (
    user &&
    !user.email_confirmed_at &&
    !user.confirmed_at &&
    request.nextUrl.pathname !== '/verificar-email' &&
    request.nextUrl.pathname !== '/auth/callback' &&
    !request.nextUrl.pathname.startsWith('/api/auth/') &&
    protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/verificar-email'
    return NextResponse.redirect(url)
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
