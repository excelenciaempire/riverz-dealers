"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, params: string[]) => void;
}

// Meta numbers template placeholders from 1 ({{1}}, {{2}}, …) and the
// indices passed to the Graph API must be contiguous starting at 1.
// We sort + dedupe here so a body using only {{2}} still drives a single
// input slot, and so render-order matches send-order.
function extractVariables(body: string): number[] {
  const ids = new Set<number>();
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
    ids.add(Number(m[1]));
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

/**
 * ¿La plantilla tiene un botón URL con enlace DINÁMICO ({{1}})? Esas plantillas
 * (p. ej. "carrito abandonado", cuyo botón es riverz.co/r/{{token}}) requieren un
 * parámetro que solo la automatización sabe llenar — enviarlas a mano rechaza con
 * el error 131008 de Meta ("Button of type Url requires a parameter"). Las
 * bloqueamos en el envío manual y avisamos que son automáticas.
 */
function hasDynamicUrlButton(template: MessageTemplate): boolean {
  const buttons = Array.isArray(template.buttons) ? template.buttons : [];
  return buttons.some((b) => {
    const btn = b as { type?: string; url?: string; url_variable?: string };
    const isUrl = String(btn.type ?? "").toUpperCase() === "URL";
    return isUrl && (Boolean(btn.url_variable) || /\{\{\s*\d+\s*\}\}/.test(btn.url ?? ""));
  });
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const t = useT();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      // Only Approved templates are sendable through Meta — anything else
      // would 400 on the send route. Hide them rather than letting the
      // user pick a template that will be rejected.
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "Approved")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected(null);
      setParams([]);
    }
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    // Guarda: nunca dejar avanzar una plantilla de enlace dinámico (rechazaría
    // con 131008). La lista ya la deshabilita; esto es red de seguridad.
    if (hasDynamicUrlButton(template)) return;
    const vars = extractVariables(template.body_text);
    if (vars.length === 0) {
      onSelect(template, []);
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(vars.length).fill(""));
  }

  function confirm() {
    if (!selected) return;
    onSelect(selected, params);
    handleOpenChange(false);
  }

  const variables = selected ? extractVariables(selected.body_text) : [];
  const canConfirm =
    !!selected &&
    variables.every((_, i) => (params[i] ?? "").trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <LayoutTemplate className="h-4 w-4 text-accent-ink" />
            {selected ? selected.name : t("inbox.sendTemplate")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {selected ? t("inbox.variables") : t("inbox.templates")}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-accent-ink" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-foreground">{t("inbox.noApprovedTemplates")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("inbox.syncTemplatesHint")}
                </p>
              </div>
            ) : (
              templates.map((tpl) => {
                // Plantillas con botón de enlace dinámico (p. ej. carrito
                // abandonado) no se pueden enviar a mano: el {{1}} del botón lo
                // llena la automatización. Se muestran deshabilitadas con aviso.
                const autoOnly = hasDynamicUrlButton(tpl);
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    disabled={autoOnly}
                    onClick={() => !autoOnly && pickTemplate(tpl)}
                    className={cn(
                      "w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors",
                      autoOnly
                        ? "cursor-not-allowed opacity-60"
                        : "hover:border-primary/40 hover:bg-accent",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {tpl.name}
                          </p>
                          <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-accent-ink">
                            {tpl.category}
                          </Badge>
                          {tpl.language && (
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {tpl.language}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {tpl.body_text}
                        </p>
                        {autoOnly && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            {t("inbox.templateAutoOnly")}
                          </p>
                        )}
                      </div>
                      {!autoOnly && (
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="max-h-[70svh] space-y-3 overflow-y-auto">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">{t("inbox.preview")}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {variables.map((v, i) => {
              const sample = Array.isArray(selected.variable_samples)
                ? selected.variable_samples[v - 1]
                : null;
              return (
                <div key={v} className="space-y-1">
                  <Label className="text-xs text-foreground">
                    {t("inbox.variableLabel", { n: v })}
                    {sample ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        {t("inbox.variableExample", { sample })}
                      </span>
                    ) : null}
                  </Label>
                  <Input
                    value={params[i] ?? ""}
                    placeholder={sample || ""}
                    onChange={(e) => {
                      const next = [...params];
                      next[i] = e.target.value;
                      setParams(next);
                    }}
                    className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setParams([]);
                }}
                className="border-border text-foreground hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("inbox.back")}
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("inbox.send")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-foreground hover:bg-accent"
            >
              {t("inbox.cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
