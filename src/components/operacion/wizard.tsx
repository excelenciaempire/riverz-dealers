'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from '@/components/i18n/locale-link'
import { useLocalizedRouter } from '@/hooks/use-localized-router'
import { Check, Loader2, Store, Radio, Sparkles, Zap } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useSetupStatus } from '@/hooks/use-setup-status'
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Activá tu Operación IA — cuatro pasos.
 *
 * La diferencia con el checklist de siempre es qué hace el comercio en cada
 * uno: allá tenía que ir a cinco pantallas y entender cada funcionalidad; acá
 * conecta, dice qué problema quiere resolver, y Riverz arma el equipo.
 *
 * El avance se guarda en el servidor y no en el navegador porque conectar
 * Shopify y Meta te saca de la aplicación y te trae de vuelta: sin eso, cada
 * regreso te deja en el paso uno.
 */

interface Playbook {
  key: string
  titleKey: string
  whatKey: string
  role: string
}

interface Estado {
  step: number
  playbooks: string[]
  generated_agent_id: string | null
  completed_at: string | null
  catalogo: Playbook[]
  plan: { agentes: { rol: string }[]; recetas: string[] }
}

const PASOS = ['stepConnect', 'stepBrand', 'stepGoal', 'stepPlan'] as const

export function ActivacionWizard() {
  const t = useT()
  const router = useLocalizedRouter()
  const fetchWithCsrf = useFetchWithCsrf()
  const setup = useSetupStatus()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [paso, setPaso] = useState(1)

  // Retomar donde quedó: conectar Shopify y Meta te lleva fuera de la
  // aplicación y te trae de vuelta, así que el paso vive en el servidor.
  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        const res = await fetch('/api/operacion/activar', { cache: 'no-store' })
        if (!res.ok || cancelado) return
        const json = (await res.json()) as Estado
        if (cancelado) return
        setEstado(json)
        setPaso(json.step ?? 1)
      } catch {
        /* la pantalla igual sirve desde el paso uno */
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const guardar = useCallback(
    async (patch: Record<string, unknown>) => {
      const res = await fetchWithCsrf('/api/operacion/activar', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const json = (await res.json()) as Estado
        setEstado((prev) => (prev ? { ...prev, ...json } : prev))
      }
    },
    [fetchWithCsrf],
  )

  const ir = useCallback(
    (n: number) => {
      setPaso(n)
      void guardar({ step: n })
    },
    [guardar],
  )

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <ol className="flex items-center gap-2">
        {PASOS.map((k, i) => (
          <li key={k} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                i + 1 < paso
                  ? 'bg-primary text-primary-foreground'
                  : i + 1 === paso
                    ? 'border-2 border-primary text-foreground'
                    : 'border border-border text-muted-foreground',
              )}
            >
              {i + 1 < paso ? <Check className="size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                'hidden text-xs sm:block',
                i + 1 === paso ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {t(`operation.${k}`)}
            </span>
          </li>
        ))}
      </ol>

      {paso === 1 && (
        <Conectar
          tienda={setup.shopify_connected}
          canales={setup.any_channel_connected}
          onNext={() => ir(2)}
        />
      )}

      {paso === 2 && (
        <Marca
          agenteId={estado?.generated_agent_id ?? null}
          onGenerated={(id) => void guardar({ generated_agent_id: id })}
          onNext={() => ir(3)}
          onBack={() => ir(1)}
        />
      )}

      {paso === 3 && (
        <Objetivo
          catalogo={estado?.catalogo ?? []}
          elegidos={estado?.playbooks ?? []}
          onChange={(keys) => void guardar({ playbooks: keys })}
          onNext={() => ir(4)}
          onBack={() => ir(2)}
        />
      )}

      {paso === 4 && (
        <Plan
          plan={estado?.plan ?? { agentes: [], recetas: [] }}
          onBack={() => ir(3)}
          onDone={() => router.push('/operacion/validar')}
        />
      )}
    </div>
  )
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5">{children}</div>
}

function Conectar({
  tienda,
  canales,
  onNext,
}: {
  tienda: boolean
  canales: boolean
  onNext: () => void
}) {
  const t = useT()
  const filas = [
    { icon: Store, label: t('operation.connectStore'), ok: tienda },
    { icon: Radio, label: t('operation.connectChannels'), ok: canales },
  ]
  return (
    <Tarjeta>
      <p className="text-sm text-muted-foreground">{t('operation.connectHint')}</p>
      <ul className="mt-4 space-y-2">
        {filas.map((f) => (
          <li
            key={f.label}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <f.icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-sm text-foreground">{f.label}</span>
            {f.ok ? (
              <span className="flex items-center gap-1 text-xs text-accent-ink">
                <Check className="size-3.5" />
                {t('operation.connected')}
              </span>
            ) : (
              <Link
                href="/integraciones"
                className="text-xs font-medium text-foreground underline underline-offset-4"
              >
                {t('operation.goConnect')}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end">
        <Button onClick={onNext}>{t('operation.next')}</Button>
      </div>
    </Tarjeta>
  )
}

function Marca({
  agenteId,
  onGenerated,
  onNext,
  onBack,
}: {
  agenteId: string | null
  onGenerated: (id: string) => void
  onNext: () => void
  onBack: () => void
}) {
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  const [url, setUrl] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState(false)
  const [listo, setListo] = useState(Boolean(agenteId))
  const [nombre, setNombre] = useState('')

  const leer = async () => {
    if (!url.trim() || leyendo) return
    setLeyendo(true)
    setError(false)
    try {
      const res = await fetchWithCsrf('/api/ai/agents/generate-from-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!res.ok) throw new Error('failed')
      const json = (await res.json()) as { agent?: { id: string; name: string } }
      if (json.agent?.id) {
        onGenerated(json.agent.id)
        setNombre(json.agent.name)
        setListo(true)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <Tarjeta>
      {listo ? (
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-ink" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('operation.brandDone')}</p>
            {nombre && <p className="mt-0.5 text-sm text-muted-foreground">{nombre}</p>}
          </div>
        </div>
      ) : (
        <>
          <label className="text-sm font-medium text-foreground">
            {t('operation.brandUrlLabel')}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('operation.brandUrlHint')}
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              className="bg-background"
            />
            <Button onClick={() => void leer()} disabled={leyendo || !url.trim()}>
              {leyendo ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t('operation.brandRead')
              )}
            </Button>
          </div>
          {leyendo && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('operation.brandReading')}
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {t('operation.brandError')}
            </p>
          )}
        </>
      )}

      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('operation.back')}
        </button>
        <div className="flex items-center gap-3">
          {!listo && (
            <button
              onClick={onNext}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('operation.brandSkip')}
            </button>
          )}
          <Button onClick={onNext}>{t('operation.next')}</Button>
        </div>
      </div>
    </Tarjeta>
  )
}

function Objetivo({
  catalogo,
  elegidos,
  onChange,
  onNext,
  onBack,
}: {
  catalogo: Playbook[]
  elegidos: string[]
  onChange: (keys: string[]) => void
  onNext: () => void
  onBack: () => void
}) {
  const t = useT()
  const [sel, setSel] = useState<string[]>(elegidos)

  const toggle = (k: string) => {
    const next = sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]
    setSel(next)
    onChange(next)
  }

  return (
    <Tarjeta>
      <p className="text-sm font-medium text-foreground">{t('operation.goalTitle')}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('operation.goalHint')}</p>
      <div className="mt-4 space-y-2">
        {catalogo.map((p) => {
          const on = sel.includes(p.key)
          return (
            <button
              key={p.key}
              onClick={() => toggle(p.key)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}
              >
                {on && <Check className="size-3" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {t(p.titleKey)}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(p.whatKey)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('operation.back')}
        </button>
        <Button onClick={onNext} disabled={sel.length === 0}>
          {t('operation.next')}
        </Button>
      </div>
    </Tarjeta>
  )
}

function Plan({
  plan,
  onBack,
  onDone,
}: {
  plan: { agentes: { rol: string }[]; recetas: string[] }
  onBack: () => void
  onDone: () => void
}) {
  const t = useT()
  const fetchWithCsrf = useFetchWithCsrf()
  const [aplicando, setAplicando] = useState(false)
  const [hecho, setHecho] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const aplicar = async () => {
    setAplicando(true)
    setError(null)
    try {
      const res = await fetchWithCsrf('/api/operacion/activar', { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      setHecho(true)
    } catch {
      setError(t('operation.planFailed'))
    } finally {
      setAplicando(false)
    }
  }

  if (hecho) {
    return (
      <Tarjeta>
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-4 shrink-0 text-accent-ink" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('operation.planDone')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('operation.planDoneHint')}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onDone}>{t('operation.validationRun')}</Button>
        </div>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta>
      <p className="text-sm font-medium text-foreground">{t('operation.planTitle')}</p>

      {plan.agentes.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t('operation.planAgents')}
          </p>
          <ul className="mt-1.5 space-y-1">
            {plan.agentes.map((a) => (
              <li key={a.rol} className="flex items-center gap-2 text-sm text-foreground">
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                {t(`operation.role${ROLE_KEY[a.rol] ?? 'General'}Name`)}
                <span className="text-xs text-muted-foreground">
                  {t(`operation.role${ROLE_KEY[a.rol] ?? 'General'}What`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.recetas.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t('operation.planAutomations')}
          </p>
          <ul className="mt-1.5 space-y-1">
            {plan.recetas.map((r) => (
              <li key={r} className="flex items-center gap-2 text-sm text-foreground">
                <Zap className="size-3.5 shrink-0 text-muted-foreground" />
                {t(`automations.tpl_${r}_name`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        {t('operation.planPaused')}
      </p>

      {/* Las reglas del comercio, antes de montar. Sin ellas se monta con los
          mínimos seguros —que es correcto, pero le deja el agente sin poder
          hacer casi nada— y el comercio no se entera de que había algo que
          decir. */}
      <Link
        href="/operacion/pliego"
        className="mt-3 block text-sm text-accent-ink transition-colors hover:underline"
      >
        {t('operation.motorRevisarReglas')}
      </Link>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('operation.back')}
        </button>
        <Button onClick={() => void aplicar()} disabled={aplicando}>
          {aplicando ? t('operation.planApplying') : t('operation.planApply')}
        </Button>
      </div>
    </Tarjeta>
  )
}

/** Sufijo i18n de cada rol; el plan viene con la clave interna. */
const ROLE_KEY: Record<string, string> = {
  general: 'General',
  ventas: 'Sales',
  postventa: 'Aftersale',
  recuperacion: 'Recovery',
  retencion: 'Retention',
}
