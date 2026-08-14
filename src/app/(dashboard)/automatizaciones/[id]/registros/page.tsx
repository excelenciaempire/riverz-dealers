"use client"

import { use, useEffect, useState } from "react"
import { useLocalizedRouter } from "@/hooks/use-localized-router"
import {
  ArrowLeft,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react"

import { idColumn } from "@/lib/short-id"
import { createClient } from "@/lib/supabase/client"
import type { Automation, AutomationLog } from "@/types"
import { Button } from "@/components/ui/button"
import { RunJourney } from "@/components/automations/run-journey"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/automations/trigger-meta"
import { useT } from "@/hooks/use-locale"

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useLocalizedRouter()
  const t = useT()

  const [automation, setAutomation] = useState<Automation | null>(null)
  const [logs, setLogs] = useState<AutomationLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openLogId, setOpenLogId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        // Mismo cuidado que en la pantalla de estadísticas: la URL puede
        // traer el id corto, y `automation_logs.automation_id` es un uuid.
        // Se resuelve primero la automatización y recién después se piden
        // sus registros con el id real.
        const autRes = await supabase
          .from("automations")
          .select("*")
          .eq(idColumn(id), id)
          .maybeSingle()
        if (autRes.error) throw autRes.error
        const automationRow = autRes.data as Automation | null

        const logRes = automationRow
          ? await supabase
              .from("automation_logs")
              .select("*, contact:contacts(id, name, phone)")
              .eq("automation_id", automationRow.id)
              .order("created_at", { ascending: false })
              .limit(100)
          : { data: [], error: null }
        if (logRes.error) throw logRes.error

        setAutomation(automationRow)
        setLogs((logRes.data ?? []) as AutomationLog[])
      } catch (err) {
        setError(t("automations.logsLoadFailed"))
      }
    }
    load()
  }, [id, t])

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
                className="rounded-xl border border-border bg-card"
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
                    {formatRelative(log.created_at)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    <RunJourney log={log} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
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

