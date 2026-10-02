import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { leerCortes } from '@/lib/dashboard/cortes'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { workspaceTimezone } from '@/lib/workspaces/timezone'
import { DashboardAccessError } from '@/lib/dashboard/access'
import { dashboardHeaders, outcomeRange } from '@/lib/dashboard/http'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Quién atendió: por canal y por agente.
 *
 * Inicio contaba el volumen por canal y nada más, así que no se podía saber
 * dónde está trabajando la IA. Esto lo corta por los dos lados.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const locale = await getLocale()
  const failure = (key: string, status: number) => NextResponse.json({ error: translate(locale, `dashboard.${key}`) }, { status, headers: dashboardHeaders })
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return failure('outcomeUnauthorized', 401)

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return failure('outcomeUnauthorized', 401)

  const url = new URL(request.url)
  const ahora = Date.now()
  const range = url.search ? outcomeRange(request) : { start: new Date(ahora - 30 * 86_400_000).toISOString(), end: new Date(ahora).toISOString() }
  if (!range) return failure('outcomeInvalid', 400)

  // La zona del comercio decide qué es "fuera de horario": a las 22 h de Buenos
  // Aires no hay nadie atendiendo aunque en UTC sea media tarde.
  try {
  const tz = await workspaceTimezone(admin, workspaceId)

  const cortes = await leerCortes(
    admin,
    workspaceId,
    {
      desde: new Date(range.start),
      hasta: new Date(range.end),
    },
    tz,
    user.id,
  )

  return NextResponse.json(cortes, { headers: dashboardHeaders })
  } catch (error) {
    return failure(error instanceof DashboardAccessError ? 'outcomeForbidden' : 'outcomeLoadFailed', error instanceof DashboardAccessError ? 403 : 503)
  }
}
