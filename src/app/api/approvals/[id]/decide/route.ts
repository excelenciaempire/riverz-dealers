import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { decidir } from '@/lib/approvals/resolve'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { approvalDecision } from '@/lib/approvals/decision'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * POST /api/approvals/[id]/decide — la misma decisión, desde el panel.
 *
 * Aprobar EJECUTA (marca el pedido como pagado en Shopify), así que pasa por
 * CSRF y por el workspace de la sesión. `decidir()` es la misma función que usa
 * la respuesta por WhatsApp: el panel y el chat no pueden divergir, y una
 * pregunta contestada dos veces se ejecuta una sola —el UPDATE condicionado a
 * `status = 'pendiente'` se encarga.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const locale = await getLocale()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: translate(locale, 'approvals.unauthorized') }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) return NextResponse.json({ error: translate(locale, 'approvals.noWorkspace') }, { status: 403 })

  const decision = approvalDecision(await request.json().catch(() => null))
  if (!decision) {
    return NextResponse.json({ error: translate(locale, 'approvals.invalidDecision') }, { status: 400 })
  }

  const { id } = await params
  try {
    const res = await decidir(supabaseAdmin(), {
      approvalId: id,
      decision,
      via: 'panel',
      decidedBy: user.id,
      workspaceId,
    })
    return NextResponse.json(res, { status: res.ok ? 200 : 409 })
  } catch (err) {
    return serverError(err)
  }
}
