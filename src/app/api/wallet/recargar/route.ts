import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS, montoValido, urlDeRecarga } from '@/lib/wallet/recarga'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

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
    // El motivo, y en su idioma. Un código como "monto_invalido" no le dice a
    // nadie cuál es el mínimo, y una frase en español no le sirve a un comercio
    // que eligió inglés — el toast lo escribe el servidor, no la pantalla.
    return NextResponse.json(
      {
        error: translate(await getLocale(), 'settings.walletAmountRange', {
          min: `US$${MINIMO_CENTAVOS / 100}`,
          max: `US$${MAXIMO_CENTAVOS / 100}`,
        }),
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
    return NextResponse.json({ error: await enEspanolDelUsuario(e) }, { status: 400 })
  }
}

/**
 * El error de la capa de abajo, en el idioma de quien lo va a leer.
 *
 * Las funciones de la billetera lanzan CÓDIGOS —`monto_fuera_de_rango`— porque
 * no saben en qué idioma está mirando esa persona. Acá sí se sabe.
 */
async function enEspanolDelUsuario(e: unknown): Promise<string> {
  const codigo = e instanceof Error ? e.message : ''
  const locale = await getLocale()
  if (codigo === 'monto_fuera_de_rango') {
    return translate(locale, 'settings.walletAmountRange', {
      min: `US$${MINIMO_CENTAVOS / 100}`,
      max: `US$${MAXIMO_CENTAVOS / 100}`,
    })
  }
  if (codigo === 'umbral_mayor_que_recarga') {
    return translate(locale, 'settings.walletThresholdBelow')
  }
  if (codigo === 'consumo_incluido') {
    return translate(locale, 'settings.walletIncludedNoTopup')
  }
  return codigo || 'no se pudo'
}
