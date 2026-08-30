'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/hooks/use-workspace'
import { useT } from '@/hooks/use-locale'

/**
 * La única pregunta que los datos no pueden contestar.
 *
 * "Ventas por Riverz" cuenta sólo los pedidos con marca nuestra. La venta que
 * se cierra hablando y alguien carga a mano en la tienda no lleva ninguna, así
 * que no entra — y el comercio ve una cifra más chica que su realidad sin que
 * nadie le explique por qué.
 *
 * Mirando la base no se puede saber cuántas son: un pedido cargado a mano es
 * idéntico a uno que el cliente hizo solo. El único que lo sabe es el
 * comercio. Se le pregunta una vez, acá, que es donde la pregunta se entiende
 * sin contexto: justo debajo de la cifra que le falta explicación.
 *
 * Se muestra sólo a los admins y sólo mientras no haya respuesta. La respuesta
 * vive en la cuenta (`workspaces.ventas_a_mano`), no en el navegador: es un
 * dato del negocio, no una preferencia de pantalla. "Ahora no" sí es del
 * navegador — es "no me interrumpas hoy", no una respuesta.
 */

const APLAZAR_KEY = 'riverz.ventasAManoAplazada'

type Respuesta = 'seguido' | 'a_veces' | 'casi_nunca'

export function PreguntaVentasAMano() {
  const t = useT()
  const { workspace, isAdmin, loading } = useWorkspace()

  const [aplazada, setAplazada] = useState(false)
  const [enviada, setEnviada] = useState<Respuesta | null>(null)
  const [guardando, setGuardando] = useState(false)

  // En un efecto y no en el initializer: servidor y cliente arrancan iguales y
  // recién después de montar se oculta. Mismo criterio que el checklist.
  useEffect(() => {
    try {
      if (localStorage.getItem(APLAZAR_KEY) === '1') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura client-only post-montaje (hidratación segura)
        setAplazada(true)
      }
    } catch {
      /* localStorage bloqueado: se muestra igual */
    }
  }, [])

  const yaContesto = Boolean(workspace?.ventas_a_mano)
  if (loading || !workspace || !isAdmin || aplazada) return null
  if (yaContesto && !enviada) return null

  async function responder(valor: Respuesta) {
    if (!workspace || guardando) return
    setGuardando(true)
    // Optimista: la tarjeta agradece y se va sola. Si la escritura falla, el
    // dato no queda — pero la pregunta vuelve en la próxima carga, que es el
    // comportamiento correcto para algo que no es urgente.
    setEnviada(valor)
    try {
      await createClient()
        .from('workspaces')
        .update({
          ventas_a_mano: valor,
          ventas_a_mano_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', workspace.id)
    } catch {
      /* silencioso: es una pregunta, no puede romper el panel */
    }
  }

  function aplazar() {
    try {
      localStorage.setItem(APLAZAR_KEY, '1')
    } catch {
      /* no-op */
    }
    setAplazada(true)
  }

  if (enviada) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          {t('dashboard.ventasAManoThanks')}
        </p>
      </div>
    )
  }

  const opciones: Array<{ valor: Respuesta; label: string }> = [
    { valor: 'seguido', label: t('dashboard.ventasAManoSeguido') },
    { valor: 'a_veces', label: t('dashboard.ventasAManoAVeces') },
    { valor: 'casi_nunca', label: t('dashboard.ventasAManoCasiNunca') },
  ]

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('dashboard.ventasAManoTitle')}
        </h2>
        <button
          type="button"
          onClick={aplazar}
          aria-label={t('dashboard.ventasAManoLater')}
          title={t('dashboard.ventasAManoLater')}
          className="ml-auto -mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        {t('dashboard.ventasAManoHelp')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            disabled={guardando}
            onClick={() => void responder(o.valor)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
