"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"

import {
  AutomationBuilder,
  type BuilderInitial,
  type BuilderStep,
} from "@/components/automations/automation-builder"
import {
  AUTOMATION_TEMPLATES,
  getTemplate,
  automationTemplateNameKey,
  automationTemplateDescKey,
  type TemplateSlug,
} from "@/lib/automations/templates"
import { useT, useLocale } from "@/hooks/use-locale"
import type { AutomationStepType, AutomationTriggerType } from "@/types"

export default function NewAutomationPage() {
  const params = useSearchParams()
  const t = useT()
  const { locale } = useLocale()
  const template = params.get("template") as TemplateSlug | null

  const initial: BuilderInitial = useMemo(() => {
    // getTemplate localizes the seed step language code to the merchant's
    // locale (the gallery name/description come from i18n keys below).
    const def = template ? getTemplate(template, locale) : null
    if (def) {
      const steps = expandFromSeeds(
        def.steps.map((seed, idx) => ({
          index: idx,
          step_type: seed.step_type,
          step_config: seed.step_config as Record<string, unknown>,
          branch: seed.branch ?? null,
          parent_index: seed.parent_index ?? null,
        })),
      )
      return {
        name: t(automationTemplateNameKey(def.slug)),
        description: t(automationTemplateDescKey(def.slug)),
        trigger_type: def.trigger_type,
        trigger_config: def.trigger_config as Record<string, unknown>,
        is_active: false,
        steps,
      }
    }
    return {
      name: "",
      description: "",
      // Default to a currently-offered trigger (the picker is limited to
      // Shopify events + "tag added").
      trigger_type: "tag_added" as AutomationTriggerType,
      trigger_config: {},
      is_active: false,
      steps: [],
    }
  }, [template, t, locale])

  // When arriving from a gallery card we're *previewing* a template: the
  // builder shows a "Usar plantilla" CTA that persists it (and lands the
  // user in the editor) instead of the plain "Guardar borrador".
  const isTemplatePreview = !!(template && AUTOMATION_TEMPLATES[template])

  return <AutomationBuilder initial={initial} templatePreview={isTemplatePreview} />
}

interface SeedRow {
  index: number
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branch: "yes" | "no" | null
  parent_index: number | null
}

function uid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/** Template seeds are flat with parent_index references. Expand into the
 *  builder's nested tree, preserving order within each scope. */
function expandFromSeeds(rows: SeedRow[]): BuilderStep[] {
  const nodes: BuilderStep[] = rows.map((r) => ({
    cid: uid(),
    step_type: r.step_type,
    step_config: r.step_config,
    branches:
      r.step_type === "condition" ? { yes: [], no: [] } : undefined,
  }))
  const roots: BuilderStep[] = []
  rows.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i])
      return
    }
    const parent = nodes[r.parent_index]
    if (!parent.branches) parent.branches = { yes: [], no: [] }
    parent.branches[r.branch ?? "yes"].push(nodes[i])
  })
  return roots
}
