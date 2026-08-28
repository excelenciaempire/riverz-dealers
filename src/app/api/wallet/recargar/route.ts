import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS, montoValido, urlDeRecarga } from '@/lib/wallet/recarga'

/**
 * Lleva a cargar saldo.
 *
 * Devuelve la URL y no redirige: quien la pide es un botón en el cliente, y una
 * redirección desde un `fetch` no lleva a ningún lado.
 *
 * Volver de Stripe NO acredita nada. El saldo lo escribe el webhook, que es la
 * única fuente: la URL de éxito la puede escribir cualquiera.
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

  const body = (await request.json().catch(() => null)) as { centavos?: number } | null
  const centavos = Math.round(Number(body?.centavos ?? 0))
  if (!montoValido(centavos)) {
    // El motivo, no un código: el panel lo muestra tal cual, y "monto_invalido"
    // no le dice a nadie que el mínimo son cinco dólares.
    return NextResponse.json(
      {
        error: `El monto tiene que estar entre US$${MINIMO_CENTAVOS / 100} y US$${MAXIMO_CENTAVOS / 100}.`,
      },
      { status: 400 },
    )
  }

  try {
    const { data: ws } = await admin
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .maybeSingle()
    const url = await urlDeRecarga(admin, workspaceId, centavos, {
      email: user.email ?? null,
      nombre: (ws as { name?: string } | null)?.name ?? null,
    })
    return NextResponse.json({ url })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'no se pudo' },
      { status: 400 },
    )
  }
}
