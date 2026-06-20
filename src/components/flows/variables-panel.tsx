"use client";

/**
 * Panel flotante con las variables disponibles en el flujo. Se abre
 * desde el botón "Variables" en la esquina inferior izquierda y muestra
 * todo lo que el merchant puede interpolar como {{vars.X}} dentro de
 * cualquier nodo de texto.
 *
 * Categorías:
 *   1. Cliente: {{customer.name}}, {{customer.phone}}, {{customer.email}}
 *      (vienen del contacto en runtime).
 *   2. Variables guardadas por nodos collect_input: por cada nodo de
 *      ese tipo con var_key, mostramos {{vars.<var_key>}}.
 *   3. Resultados de shopify_lookup: por cada nodo de ese tipo, los
 *      sufijos correspondientes al kind elegido prefijados por
 *      output_prefix.
 *
 * Click sobre una variable la copia al portapapeles — el merchant la
 * pega en el textarea del nodo donde la necesite. Es más simple que
 * drag-and-drop a un campo específico y funciona en cualquier input.
 */

import { useState } from "react";
import { Variable, Copy, ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useT } from "@/hooks/use-locale";
import type { TFn } from "@/lib/i18n/translate";

interface FlowNode {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

interface VarRow {
  category: string;
  expression: string;
  source: string;
}

export function VariablesPanel({ nodes }: { nodes: FlowNode[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copiedExpr, setCopiedExpr] = useState<string | null>(null);
  const vars = buildAvailableVariables(nodes, t);

  const copy = async (expr: string) => {
    try {
      await navigator.clipboard.writeText(expr);
      setCopiedExpr(expr);
      toast.success(t("flows.varCopied", { expr }));
      setTimeout(() => setCopiedExpr(null), 1500);
    } catch {
      toast.error(t("flows.copyFailed"));
    }
  };

  // Agrupar por categoría.
  const byCategory = vars.reduce<Record<string, VarRow[]>>((acc, v) => {
    (acc[v.category] ||= []).push(v);
    return acc;
  }, {});

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border border-border",
          "bg-card px-3 text-sm font-medium text-foreground shadow-lg shadow-black/20",
          "transition-colors hover:bg-muted",
        )}
        aria-label={t("flows.viewAvailableVariables")}
      >
        <Variable className="size-4" />
        {t("flows.variables")}
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronUp className="size-3.5" />
        )}
      </button>

      {open && (
        <div
          className={cn(
            "mb-2 max-h-[60vh] w-80 overflow-y-auto rounded-xl border border-border",
            "bg-card p-3 shadow-2xl shadow-black/40",
          )}
        >
          <div className="mb-2 border-b border-border pb-2">
            <p className="text-sm font-semibold text-foreground">
              {t("flows.flowVariables")}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t("flows.variablesHint")}
            </p>
          </div>
          {Object.keys(byCategory).length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t("flows.noVariablesYet")}
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCategory).map(([category, rows]) => (
                <div key={category}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {category}
                  </p>
                  <ul className="space-y-0.5">
                    {rows.map((v) => (
                      <li key={v.expression}>
                        <button
                          type="button"
                          onClick={() => copy(v.expression)}
                          className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
                        >
                          <div className="min-w-0 flex-1">
                            <code className="block text-xs text-foreground">
                              {v.expression}
                            </code>
                            <span className="block text-[10px] text-muted-foreground">
                              {v.source}
                            </span>
                          </div>
                          {copiedExpr === v.expression ? (
                            <Check className="size-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const SHOPIFY_ORDER_SUFFIXES = [
  "name",
  "number",
  "email",
  "financial_status",
  "fulfillment_status",
  "total",
  "status_url",
  "tracking_number",
  "tracking_url",
  "tracking_company",
  "item_count",
  "first_item",
];

const SHOPIFY_PRODUCT_SUFFIXES = [
  "title",
  "handle",
  "vendor",
  "type",
  "price",
  "image_url",
];

function buildAvailableVariables(nodes: FlowNode[], t: TFn): VarRow[] {
  const rows: VarRow[] = [
    {
      category: t("flows.varCategoryCustomer"),
      expression: "{{customer.name}}",
      source: t("flows.varCustomerName"),
    },
    {
      category: t("flows.varCategoryCustomer"),
      expression: "{{customer.phone}}",
      source: t("flows.varCustomerPhone"),
    },
    {
      category: t("flows.varCategoryCustomer"),
      expression: "{{customer.email}}",
      source: t("flows.varCustomerEmail"),
    },
  ];

  for (const n of nodes) {
    if (n.node_type === "collect_input") {
      const cfg = n.config as { var_key?: string; prompt_text?: string };
      if (cfg.var_key) {
        rows.push({
          category: t("flows.varCategoryCollected"),
          expression: `{{vars.${cfg.var_key}}}`,
          source: cfg.prompt_text
            ? truncate(cfg.prompt_text, 50)
            : t("flows.varNode", { key: n.node_key }),
        });
      }
    } else if (n.node_type === "shopify_lookup") {
      const cfg = n.config as {
        kind?: string;
        output_prefix?: string;
      };
      const prefix = (cfg.output_prefix || "order").trim();
      const isProduct = cfg.kind === "product_by_handle";
      const suffixes = isProduct
        ? SHOPIFY_PRODUCT_SUFFIXES
        : SHOPIFY_ORDER_SUFFIXES;
      const sourceLabel = isProduct
        ? t("flows.varProductOf", { key: n.node_key })
        : t("flows.varOrderOf", { key: n.node_key });
      for (const s of suffixes) {
        rows.push({
          category: t("flows.varCategoryShopify"),
          expression: `{{vars.${prefix}_${s}}}`,
          source: sourceLabel,
        });
      }
    }
  }

  return rows;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
