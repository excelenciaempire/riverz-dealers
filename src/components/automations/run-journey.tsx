"use client"

import {
  FileText,
  MessageSquare,
  Hourglass,
  GitFork,
  Tag,
  UserCheck,
  PencilLine,
  CircleSlash,
  PhoneCall,
  Webhook,
  Zap,
  Check,
  X,
  Minus,
} from "lucide-react"

import type { AutomationLog, AutomationLogStepResult } from "@/types"
import { cn } from "@/lib/utils"
import { useT } from "@/hooks/use-locale"
import type { TFn } from "@/lib/i18n/translate"

// ------------------------------------------------------------
// Run journey — the element-by-element path one contact took through an
// automation, rebuilt from automation_logs.steps_executed (a flat, ordered
// trace the engine appends as it walks, branch children included). Rendered as
// a vertical timeline so a merchant can audit exactly what happened, step by
// step. Shared by the stats page (expandable rows) and the full logs page.
// ------------------------------------------------------------

const STEP_ICON: Record<string, typeof Zap> = {
  send_message: MessageSquare,
  send_template: FileText,
  wait: Hourglass,
  condition: GitFork,
  add_tag: Tag,
  remove_tag: Tag,
  assign_conversation: UserCheck,
  update_contact_field: PencilLine,
  close_conversation: CircleSlash,
  voice_call: PhoneCall,
  send_webhook: Webhook,
}

const STEP_LABEL_KEY: Record<string, string> = {
  send_message: "automations.stepSendMessage",
  send_template: "automations.stepSendTemplate",
  wait: "automations.stepWait",
  condition: "automations.stepCondition",
  add_tag: "automations.stepAddTag",
  remove_tag: "automations.stepRemoveTag",
  assign_conversation: "automations.stepAssignConversation",
  update_contact_field: "automations.stepUpdateContactField",
  set_context: "automations.stepSetContext",
  close_conversation: "automations.stepCloseConversation",
  voice_call: "automations.stepVoiceCall",
  send_webhook: "automations.stepSendWebhook",
}

const WAIT_UNIT_KEY: Record<string, [string, string]> = {
  seconds: ["automations.waitSecondOne", "automations.waitSecondOther"],
  minutes: ["automations.waitMinuteOne", "automations.waitMinuteOther"],
  hours: ["automations.waitHourOne", "automations.waitHourOther"],
  days: ["automations.waitDayOne", "automations.waitDayOther"],
}

function stepLabel(type: string, t: TFn): string {
  const key = STEP_LABEL_KEY[type]
  return key ? t(key) : type
}

/** Turn the engine's terse English `detail` into a friendly, localized form.
 *  `branch` drives the Sí/No pill on a condition; `note` is a muted subline.
 *  Unknown details fall through verbatim so nothing is ever hidden. */
function friendlyDetail(
  r: AutomationLogStepResult,
  t: TFn,
): { branch?: "yes" | "no"; note?: string } {
  const d = r.detail ?? ""
  if (r.step_type === "condition") {
    const m = /branch=(yes|no)/.exec(d)
    if (m) return { branch: m[1] as "yes" | "no" }
  }
  if (r.step_type === "wait") {
    const m = /waiting\s+(\d+)\s+(seconds|minutes|hours|days)/.exec(d)
    if (m) {
      const n = Number(m[1])
      const [one, many] = WAIT_UNIT_KEY[m[2]] ?? []
      const unit = one ? t(n === 1 ? one : many) : m[2]
      return { note: t("automations.journeyWaited", { duration: `${n} ${unit}` }) }
    }
  }
  return { note: d || undefined }
}

function TimelineNode({
  icon: Icon,
  tone,
  title,
  branch,
  note,
  last,
}: {
  icon: typeof Zap
  tone: "trigger" | "ok" | "skipped" | "failed"
  title: string
  branch?: "yes" | "no"
  note?: string
  last: boolean
}) {
  const t = useT()
  const dot =
    tone === "failed"
      ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
      : tone === "skipped"
        ? "border-border bg-muted text-muted-foreground"
        : tone === "trigger"
          ? "border-primary/40 bg-primary/10 text-accent-ink"
          : "border-primary/30 bg-primary/5 text-accent-ink"
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && (
        <span
          className="absolute left-[11px] top-6 bottom-0 w-px bg-border"
          aria-hidden
        />
      )}
      <span
        className={cn(
          "relative z-10 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border",
          dot,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-medium text-foreground">{title}</span>
          {branch && (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                branch === "yes"
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {branch === "yes" ? t("automations.branchYes") : t("automations.branchNo")}
            </span>
          )}
          {tone === "failed" && (
            <X className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden />
          )}
          {tone === "skipped" && (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          {tone === "ok" && (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
        </div>
        {note && (
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{note}</p>
        )}
      </div>
    </li>
  )
}

/** The full journey for one run: an optional error banner, a "triggered" entry
 *  node, then one node per executed step in order. */
export function RunJourney({ log }: { log: AutomationLog }) {
  const t = useT()
  const steps = log.steps_executed ?? []
  return (
    <div className="space-y-3">
      {log.error_message && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {log.error_message}
        </p>
      )}
      <ol className="relative">
        <TimelineNode
          icon={Zap}
          tone="trigger"
          title={t("automations.journeyTrigger")}
          note={log.trigger_event}
          last={steps.length === 0}
        />
        {steps.map((r, i) => {
          const { branch, note } = friendlyDetail(r, t)
          const tone =
            r.status === "failed" ? "failed" : r.status === "skipped" ? "skipped" : "ok"
          return (
            <TimelineNode
              key={i}
              icon={STEP_ICON[r.step_type] ?? Zap}
              tone={tone}
              title={stepLabel(r.step_type, t)}
              branch={branch}
              note={note}
              last={i === steps.length - 1}
            />
          )
        })}
      </ol>
    </div>
  )
}
