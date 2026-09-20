import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { guardarConfigAuto, quitarTarjeta, urlDeTarjeta } from '@/lib/wallet/auto'
import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS } from '@/lib/wallet/recarga'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * La recarga automática: guardar la tarjeta y decir cuándo cobrarla.
 *
 *   POST { tarjeta: true }              → URL para guardar la tarjeta
 *   POST { recargaCentavos, umbralCentavos } → prende la recarga
 *   POST { apagar: true }               → la apaga
 *
 * Guardar la tarjeta NO cobra nada: es una autorización. Y la tarjeta no pasa
 * por acá en ningún momento — la escribe el comercio en el formulario de
 * Stripe, y de vuelta llega sólo un identificador.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as {
    tarjeta?: boolean
    borrarTarjeta?: boolean
    apagar?: boolean
    recargaCentavos?: number
    umbralCentavos?: number
  } | null

  try {
    if (body?.tarjeta) {
      const { data: ws } = await admin
        .from('workspaces')
        .select('name')
        .eq('id', workspaceId)
        .maybeSingle()
      const url = await urlDeTarjeta(admin, workspaceId, {
        email: user.email ?? null,
        nombre: (ws as { name?: string } | null)?.name ?? null,
      })
      return NextResponse.json({ url })
    }

    // Quitar la tarjeta apaga la recarga automática: dejar la configuración
    // prendida sin tarjeta sería prometer un cobro que no se puede hacer.
    if (body?.borrarTarjeta) {
      await quitarTarjeta(admin, workspaceId)
      return NextResponse.json({ ok: true })
    }

    if (body?.apagar) {
      await guardarConfigAuto(admin, workspaceId, {
        recargaCentavos: null,
        umbralCentavos: null,
      })
      return NextResponse.json({ ok: true })
    }

    await guardarConfigAuto(admin, workspaceId, {
      recargaCentavos: Math.round(Number(body?.recargaCentavos ?? 0)),
      umbralCentavos: Math.round(Number(body?.umbralCentavos ?? 0)),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const codigo = e instanceof Error ? e.message : ''
    const locale = await getLocale()
    const mensaje =
      codigo === 'monto_fuera_de_rango'
        ? translate(locale, 'settings.walletAmountRange', {
            min: `US$${MINIMO_CENTAVOS / 100}`,
            max: `US$${MAXIMO_CENTAVOS / 100}`,
          })
        : codigo === 'umbral_mayor_que_recarga'
          ? translate(locale, 'settings.walletThresholdBelow')
          : codigo === 'consumo_incluido'
            ? translate(locale, 'settings.walletIncludedNoTopup')
          : codigo || 'no se pudo'
    return NextResponse.json({ error: mensaje }, { status: 400 })
  }
}
