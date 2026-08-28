import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { leerBilletera } from '@/lib/wallet/saldo'
import { rangoDe, resumen } from '@/lib/wallet/movimientos'
import { listarTarifas } from '@/lib/wallet/tarifas'
import { stripeDisponible } from '@/lib/billing/stripe'
import { SUGERIDOS_CENTAVOS } from '@/lib/wallet/recarga'

/**
 * El saldo y en qué se fue, para el panel.
 *
 * Una sola llamada devuelve las tres cosas que la pantalla necesita —cuánto
 * queda, cómo se movió en el rango y cuánto sale cada cosa— porque son una sola
 * pregunta para quien mira y partirlas en tres viajes sólo hace parpadear la
 * pantalla.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const url = new URL(request.url)
  const rango = rangoDe(url.searchParams.get('desde'), url.searchParams.get('hasta'))

  const [billetera, datos, tarifas] = await Promise.all([
    leerBilletera(admin, workspaceId),
    resumen(admin, workspaceId, rango),
    listarTarifas(admin),
  ])

  return NextResponse.json(
    {
      saldoCentavos: billetera.saldoCentavos,
      moneda: billetera.moneda,
      bloquearSinSaldo: billetera.bloquearSinSaldo,
      resumen: datos,
      tarifas: tarifas
        .filter((t) => t.activo)
        .map((t) => ({
          concepto: t.concepto,
          nombreEs: t.nombreEs,
          nombreEn: t.nombreEn,
          unidad: t.unidad,
          precioMilicentavos: t.precioMilicentavos,
        })),
      // Sin Stripe configurado no se ofrece un botón de recargar que no puede
      // funcionar.
      puedeRecargar: stripeDisponible(),
      sugeridos: SUGERIDOS_CENTAVOS,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
