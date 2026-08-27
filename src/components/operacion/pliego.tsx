'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * El pliego de la marca, en pantalla.
 *
 * Se contesta en una reunión de instalación o solo, y son las respuestas que
 * después lee el Operador para montar la cuenta. Tres decisiones que hacen que
 * no se sienta un formulario:
 *
 *  1. **Todo llega contestado.** Cada pregunta muestra su valor por defecto
 *     marcado. Contestar es corregir lo que no coincide, no llenar campos.
 *  2. **Guarda solo.** No hay botón de guardar: cada toque va al servidor. En
 *     una reunión nadie se acuerda de guardar antes de cerrar la pestaña.
 *  3. **La lista la arma el servidor.** Qué preguntas aparecen depende de qué
 *     está conectado y de lo ya contestado, y esa regla vive en un solo lado:
 *     el PATCH devuelve los bloques recalculados. Por eso decir "sí trabajo
 *     contraentrega" hace aparecer la pregunta por las zonas.
 */

interface Opcion {
  valor: string
  labelKey: string
}

interface Pregunta {
  id: string
  labelKey: string
  ayudaKey: string | null
  tipo: 'opcion' | 'multi' | 'texto' | 'numero' | 'horario' | 'herramienta'
  opciones: Opcion[] | null
  porDefecto: unknown
  min: number | null
  max: number | null
}

interface Bloque {
  id: string
  tituloKey: string
  notaKey: string | null
  preguntas: Pregunta[]
}

interface Estado {
  bloques: Bloque[]
  respuestas: Record<string, unknown>
  faltantes: number
}

interface Horario {
  desde: string
  hasta: string
}

export function Pliego({ onListo }: { onListo?: () => void }) {
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [guardando, setGuardando] = useState(false)
  // Lo contestado en esta sesión, para pintar el tilde de "guardado" sin
  // esperar a que vuelva el servidor.
  const pendiente = useRef<Record<string, unknown>>({})

  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        const res = await fetch('/api/operacion/pliego', { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as Estado
        if (!cancelado) setEstado(json)
      } catch {
        /* la pantalla se queda vacía; no hay nada que romper */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const guardar = useCallback(
    async (id: string, valor: unknown) => {
      // Optimista: la pantalla se mueve con el dedo, no con la red.
      setEstado((prev) =>
        prev ? { ...prev, respuestas: { ...prev.respuestas, [id]: valor } } : prev,
      )
      pendiente.current[id] = valor
      setGuardando(true)
      try {
        const res = await fetchWithCsrf('/api/operacion/pliego', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ respuestas: { [id]: valor } }),
        })
        if (res.ok) {
          const json = (await res.json()) as Estado
          setEstado(json)
        }
      } catch {
        /* queda lo optimista: el próximo toque reintenta */
      } finally {
        setGuardando(false)
      }
    },
    [fetchWithCsrf],
  )

  if (!estado) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  const valorDe = (p: Pregunta) =>
    estado.respuestas[p.id] !== undefined ? estado.respuestas[p.id] : p.porDefecto

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <header>
        <h2 className="text-xl font-semibold text-foreground">{t('pliego.titulo')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('pliego.bajada')}</p>
        <p className="mt-3 text-xs text-muted-foreground">{t('pliego.faltan')}</p>
      </header>

      {estado.bloques.map((b) => (
        <section key={b.id} className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t(b.tituloKey)}</h3>
            {b.notaKey && (
              <p className="mt-0.5 text-xs text-muted-foreground">{t(b.notaKey)}</p>
            )}
          </div>
          <div className="space-y-5">
            {b.preguntas.map((p) => (
              <div key={p.id} className="space-y-2">
                <label className="block text-sm text-foreground">{t(p.labelKey)}</label>
                {p.ayudaKey && (
                  <p className="text-xs text-muted-foreground">{t(p.ayudaKey)}</p>
                )}
                <Campo
                  pregunta={p}
                  valor={valorDe(p)}
                  onChange={(v) => void guardar(p.id, v)}
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      <footer className="flex items-center justify-between border-t border-border pt-4">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {guardando ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              {t('pliego.guardando')}
            </>
          ) : (
            <>
              <Check className="size-3" />
              {t('pliego.guardado')}
            </>
          )}
        </span>
        {onListo && (
          <button
            onClick={onListo}
            className="text-sm font-medium text-primary transition-colors hover:underline"
          >
            {t('pliego.listo')}
          </button>
        )}
      </footer>
    </div>
  )
}

function Campo({
  pregunta,
  valor,
  onChange,
}: {
  pregunta: Pregunta
  valor: unknown
  onChange: (v: unknown) => void
}) {
  const t = useT()

  if (pregunta.tipo === 'opcion' || pregunta.tipo === 'herramienta') {
    return (
      <div className="flex flex-wrap gap-2">
        {(pregunta.opciones ?? []).map((o) => (
          <Pastilla
            key={o.valor}
            activa={valor === o.valor}
            onClick={() => onChange(o.valor)}
          >
            {t(o.labelKey)}
          </Pastilla>
        ))}
      </div>
    )
  }

  if (pregunta.tipo === 'multi') {
    const vals = Array.isArray(valor) ? (valor as string[]) : []
    return (
      <div className="flex flex-wrap gap-2">
        {(pregunta.opciones ?? []).map((o) => {
          const on = vals.includes(o.valor)
          return (
            <Pastilla
              key={o.valor}
              activa={on}
              onClick={() =>
                onChange(on ? vals.filter((v) => v !== o.valor) : [...vals, o.valor])
              }
            >
              {t(o.labelKey)}
            </Pastilla>
          )
        })}
      </div>
    )
  }

  if (pregunta.tipo === 'numero') {
    return (
      <Input
        type="number"
        className="max-w-28"
        min={pregunta.min ?? undefined}
        max={pregunta.max ?? undefined}
        defaultValue={Number(valor ?? 0)}
        onBlur={(e) => onChange(Number(e.target.value))}
      />
    )
  }

  if (pregunta.tipo === 'horario') {
    const h = (valor ?? { desde: '09:00', hasta: '18:00' }) as Horario
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('pliego.horaDesde')}</span>
        <Input
          type="time"
          className="max-w-32"
          value={h.desde}
          onChange={(e) => onChange({ ...h, desde: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">{t('pliego.horaHasta')}</span>
        <Input
          type="time"
          className="max-w-32"
          value={h.hasta}
          onChange={(e) => onChange({ ...h, hasta: e.target.value })}
        />
      </div>
    )
  }

  return (
    <Input
      defaultValue={String(valor ?? '')}
      onBlur={(e) => onChange(e.target.value)}
    />
  )
}

function Pastilla({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm transition-colors',
        activa
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted/50',
      )}
    >
      {children}
    </button>
  )
}
