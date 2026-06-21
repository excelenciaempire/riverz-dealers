"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLocalizedRouter } from "@/hooks/use-localized-router";

import { Button } from "@/components/ui/button";
import { FlowBuilder } from "@/components/flows/flow-builder";
import { useT, useLocale } from "@/hooks/use-locale";
import {
  getFlowTemplate,
  flowTemplateNameKey,
  flowTemplateDescKey,
} from "@/lib/flows/templates";
import {
  DEFAULT_FALLBACK_POLICY,
  type FlowRow,
  type FlowNodeRow,
} from "@/lib/flows/types";

/**
 * Vista previa de una plantilla de flujo en el LIENZO real (no un modal):
 * `/menus/nueva?template=<slug>` arma un FlowRow + nodos sintéticos a partir
 * de la plantilla y renderiza `<FlowBuilder templatePreview>`. El lienzo se
 * dibuja igual que el editor (auto-layout porque las posiciones arrancan en
 * 0,0) pero NADA se persiste hasta que el usuario toca "Usar plantilla", que
 * crea el flujo (POST /api/flows {template_slug}) y redirige al editor real.
 * Mismo patrón que automatizaciones/nueva?template=.
 */
export default function NewFlowFromTemplatePage() {
  const router = useLocalizedRouter();
  const t = useT();
  const { locale } = useLocale();
  const params = useSearchParams();
  const slug = params.get("template") ?? "";
  const template = useMemo(() => getFlowTemplate(slug, locale), [slug, locale]);

  // Timestamp estático: el FlowBuilder no lee created_at/updated_at en su
  // estado, así que un valor fijo evita cualquier mismatch de hidratación.
  const stamp = "1970-01-01T00:00:00.000Z";

  const { initialFlow, initialNodes } = useMemo(() => {
    if (!template) return { initialFlow: null, initialNodes: [] as FlowNodeRow[] };
    const flow: FlowRow = {
      id: "preview",
      workspace_id: "",
      name: t(flowTemplateNameKey(template.slug)),
      description: t(flowTemplateDescKey(template.slug)),
      status: "draft",
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config,
      entry_node_id: template.entry_node_id,
      trigger_position_x: 80,
      trigger_position_y: 240,
      fallback_policy: DEFAULT_FALLBACK_POLICY,
      execution_count: 0,
      last_executed_at: null,
      created_at: stamp,
      updated_at: stamp,
    };
    // position 0,0 => FlowBuilder corre su auto-layout una vez al montar y
    // distribuye el grafo igual que un flujo recién instalado.
    const nodes: FlowNodeRow[] = template.nodes.map((n) => ({
      id: n.node_key,
      flow_id: "preview",
      node_key: n.node_key,
      node_type: n.node_type as FlowNodeRow["node_type"],
      config: n.config as Record<string, unknown>,
      position_x: 0,
      position_y: 0,
      created_at: stamp,
    }));
    return { initialFlow: flow, initialNodes: nodes };
  }, [template, t]);

  if (!template || !initialFlow) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{t("flows.templateNotFound")}</p>
        <Button variant="outline" onClick={() => router.push("/menus")}>
          {t("flows.backToFlows")}
        </Button>
      </div>
    );
  }

  return (
    <FlowBuilder
      initialFlow={initialFlow}
      initialNodes={initialNodes}
      templatePreview
      templateSlug={template.slug}
    />
  );
}
