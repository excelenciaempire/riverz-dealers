"use client"

import { use, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocalizedRouter } from "@/hooks/use-localized-router"
import {
  ArrowLeft,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react"

import type { AutomationLog } from "@/types"
import type { AutomationHistoryPage } from "@/lib/automations/history"
import { SHOW_RIVERZ_IMPROVEMENTS } from "@/lib/ui/improvements-preview"
import { useWorkspace } from "@/hooks/use-workspace"
import { Button } from "@/components/ui/button"
import { RunJourney } from "@/components/automations/run-journey"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/automations/trigger-meta"
import { useLocale, useT } from "@/hooks/use-locale"

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useLocalizedRouter()
  const t = useT()
  const { locale } = useLocale()
  const { workspace, loading: workspaceLoading } = useWorkspace()

  /**
   * `?log=` — la corrida exacta. Lo manda "Necesita tu atención": el aviso dice
   * que fallaron dos corridas, y el clic tiene que abrir ESA, no dejar cien
   * filas plegadas para que la busque a ojo.
   */
  const deepLinkLogId = useSearchParams().get("log")

  const baseScope = `${id}:${workspace?.id ?? ''}`
  const [filters, setFilters] = useState({ scope: '', status: '', contact_id: '', contactName: '', from: '', to: '' })
  const active = filters.scope === baseScope ? filters : { scope: baseScope, status: '', contact_id: '', contactName: '', from: '', to: '' }
  const search = new URLSearchParams()
  if (deepLinkLogId) search.set('log', deepLinkLogId)
  if (SHOW_RIVERZ_IMPROVEMENTS) {
    if (active.status) search.set('status', active.status)
    if (active.contact_id) search.set('contact_id', active.contact_id)
    if (active.from) search.set('from', `${active.from}T00:00:00Z`)
    if (active.to) search.set('to', `${active.to}T23:59:59.999999Z`)
  }
  const queryString = search.toString()
  const scope = `${baseScope}:${queryString}`
  const [cursor, setCursor] = useState<{ scope: string; value: string } | null>(null)
  const next = cursor?.scope === scope ? cursor.value : null
  const [loaded, setLoaded] = useState<{ scope: string; page: AutomationHistoryPage } | null>(null)
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const changeFilters = (value: typeof filters) => { setCursor(null); setFilters(value) }
  const automation = loaded?.scope === scope ? loaded.page.automation : null
  const logs = loaded?.scope === scope ? loaded.page.logs : null
  const error = failure?.scope === scope ? failure.message : null
  const [openLogId, setOpenLogId] = useState<string | null>(null)
  /** Una sola vez: después el plegado vuelve a ser del usuario. */
  const yaAbierto = useRef('')

  useEffect(() => {
    if (workspaceLoading) return
    const controller = new AbortController()
    async function load() {
      setBusy(true)
      setFailure(null)
      try {
        const query = new URLSearchParams(queryString)
        if (next) query.set('cursor', next)
        const response = await fetch(`/api/automations/${encodeURIComponent(id)}/logs?${query}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) throw new Error('history_load_failed')
        const page = await response.json() as AutomationHistoryPage
        if (controller.signal.aborted) return
        if (workspace?.id && page.workspace_id !== workspace.id) throw new Error('history_context_changed')
        setLoaded(previous => {
          const rows = next && previous?.scope === scope ? [...previous.page.logs, ...page.logs] : [...(page.linked_log ? [page.linked_log] : []), ...page.logs]
          const unique = [...new Map(rows.map(row => [row.id, row])).values()]
          return { scope, page: { ...page, logs: unique } }
        })
      } catch {
        if (!controller.signal.aborted) setFailure({ scope, message: t("automations.logsLoadFailed") })
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [id, queryString, next, scope, t, workspaceLoading, workspace?.id, retry])

  // Abrir la corrida enlazada y traerla a la vista. Se hace acá y no en la
  // carga porque el `<li>` recién existe cuando `logs` está en pantalla.
  useEffect(() => {
    if (!deepLinkLogId || !logs || yaAbierto.current === `${scope}:${deepLinkLogId}`) return
    if (!logs.some((l) => l.id === deepLinkLogId)) return
    yaAbierto.current = `${scope}:${deepLinkLogId}`
    setOpenLogId(deepLinkLogId)
    requestAnimationFrame(() => {
      document
        .getElementById(`corrida-${deepLinkLogId}`)
        ?.scrollIntoView({ block: "center" })
    })
  }, [deepLinkLogId, logs, scope])

  if (error && !automation) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        {SHOW_RIVERZ_IMPROVEMENTS && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t('automations.historyRetry')}</Button>}
        <Button variant="outline" onClick={() => router.push("/automatizaciones")}>
          {t("automations.back")}
        </Button>
      </div>
    )
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-ink" />
      </div>


    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/automatizaciones")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("automations.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-2xl font-bold text-foreground">{automation.name}</h1>
      </div>

      {SHOW_RIVERZ_IMPROVEMENTS && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">{t('automations.historyStatus')}</span>
            <select className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground" value={active.status} onChange={event => changeFilters({ ...active, status: event.target.value })}>
              <option value="">{t('automations.historyAll')}</option>
              <option value="success">{t('automations.statusSuccessShort')}</option>
              <option value="partial">{t('automations.statusPartialShort')}</option>
              <option value="failed">{t('automations.statusErrorShort')}</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">{t('automations.historyFromUtc')}</span>
            <input type="date" className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground" value={active.from} max={active.to || undefined} onChange={event => changeFilters({ ...active, from: event.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">{t('automations.historyToUtc')}</span>
            <input type="date" className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground" value={active.to} min={active.from || undefined} onChange={event => changeFilters({ ...active, to: event.target.value })} />
          </label>
          {active.contact_id && <Button variant="outline" size="sm" aria-label={t('automations.historyClearContact')} onClick={() => changeFilters({ ...active, contact_id: '', contactName: '' })}>{active.contactName} ×</Button>}
          {(active.status || active.from || active.to || active.contact_id) && <Button variant="ghost" size="sm" onClick={() => changeFilters({ scope: baseScope, status: '', contact_id: '', contactName: '', from: '', to: '' })}>{t('automations.historyClear')}</Button>}
        </div>
      )}

      {logs.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <p className="text-sm text-foreground">{t("automations.noRuns")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const isOpen = openLogId === log.id
            return (
              <li
                key={log.id}
                id={`corrida-${log.id}`}
                className={cn(
                  "rounded-xl border bg-card",
                  deepLinkLogId === log.id
                    ? "border-amber-500/50 ring-1 ring-amber-500/30"
                    : "border-border",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <StatusBadge status={log.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {log.contact?.name ?? log.contact?.phone ?? t("automations.unknownContact")}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {log.trigger_event} ·{" "}
                      {log.steps_executed?.length === 1
                        ? t("automations.stepCountOne", { n: 1 })
                        : t("automations.stepCountOther", { n: log.steps_executed?.length ?? 0 })}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelative(log.created_at, locale)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    <RunJourney log={log} />
                    {SHOW_RIVERZ_IMPROVEMENTS && log.contact && <Button variant="ghost" size="sm" className="mt-2" onClick={() => changeFilters({ ...active, contact_id: log.contact!.id, contactName: log.contact!.name ?? log.contact!.phone ?? t('automations.unknownContact') })}>{t('automations.historyThisContact')}</Button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {error && <div role="alert" className="flex items-center gap-3 text-sm text-red-600 dark:text-red-400">{error}<Button variant="outline" size="sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>{t('automations.historyRetry')}</Button></div>}
      {SHOW_RIVERZ_IMPROVEMENTS && loaded?.scope === scope && loaded.page.next_cursor && <Button variant="outline" disabled={busy} onClick={() => setCursor({ scope, value: loaded.page.next_cursor! })}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t('automations.historyMore')}</Button>}
    </div>
  )
}

function StatusBadge({ status }: { status: AutomationLog["status"] }) {
  const t = useT()
  const classes =
    status === "success"
      ? "border-primary/30 bg-primary/10 text-accent-ink"
      : status === "partial"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300"
  const label =
    status === "success"
      ? t("automations.statusSuccessShort")
      : status === "partial"
      ? t("automations.statusPartialShort")
      : t("automations.statusErrorShort")
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        classes,
      )}
    >
      {label}
    </span>
  )
}

