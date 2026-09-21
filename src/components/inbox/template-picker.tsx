"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Check,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Pencil,
  Search,
  X,
} from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, params: string[], headerImage?: File) => void;
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

function getTemplateButtons(template: MessageTemplate): { text: string; type: string }[] {
  if (!Array.isArray(template.buttons)) return [];
  return template.buttons.flatMap((button) => {
    const text = typeof button.text === "string" ? button.text.trim() : "";
    if (!text) return [];
    return [{ text, type: String(button.type ?? "").toUpperCase() }];
  });
}

function readableTemplateName(name: string): string {
  const words = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function templateDisplayName(template: MessageTemplate): string {
  return (
    template.variable_fields?.__internal_name?.trim() ||
    readableTemplateName(template.name)
  );
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
  const [query, setQuery] = useState("");
  const [headerImage, setHeaderImage] = useState<File | null>(null);
  const [headerImageError, setHeaderImageError] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: 0 });
  }, [open, query]);

  const headerPreviewUrl = useMemo(
    () => (headerImage ? URL.createObjectURL(headerImage) : null),
    [headerImage],
  );

  useEffect(() => {
    if (!headerPreviewUrl) return;
    return () => URL.revokeObjectURL(headerPreviewUrl);
  }, [headerPreviewUrl]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected(null);
      setParams([]);
      setQuery("");
      setHeaderImage(null);
      setHeaderImageError(null);
      setEditingNameId(null);
      setNameDraft("");
    }
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    // Guarda: nunca dejar avanzar una plantilla de enlace dinámico (rechazaría
    // con 131008). La lista ya la deshabilita; esto es red de seguridad.
    if (hasDynamicUrlButton(template)) return;
    const vars = extractVariables(template.body_text);
    if (vars.length === 0 && template.header_type !== "image") {
      onSelect(template, []);
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(vars.length).fill(""));
    setHeaderImage(null);
    setHeaderImageError(null);
  }

  function confirm() {
    if (!selected) return;
    onSelect(selected, params, headerImage ?? undefined);
    handleOpenChange(false);
  }

  function chooseHeaderImage(file: File | null) {
    setHeaderImageError(null);
    if (!file) {
      setHeaderImage(null);
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setHeaderImage(null);
      setHeaderImageError(t("inbox.templateImageTypeError"));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setHeaderImage(null);
      setHeaderImageError(t("inbox.fileTooLarge"));
      return;
    }
    setHeaderImage(file);
  }

  async function saveDisplayName(template: MessageTemplate) {
    if (savingName) return;
    setSavingName(true);
    const displayName = nameDraft.trim() || null;
    const variableFields = { ...(template.variable_fields ?? {}) };
    if (displayName) variableFields.__internal_name = displayName;
    else delete variableFields.__internal_name;
    const storedFields = Object.keys(variableFields).length > 0 ? variableFields : null;
    const supabase = createClient();
    const { error } = await supabase
      .from("message_templates")
      .update({ variable_fields: storedFields })
      .eq("id", template.id);
    if (error) {
      toast.error(t("inbox.templateNameSaveFailed"));
    } else {
      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? { ...item, variable_fields: storedFields } : item,
        ),
      );
      setEditingNameId(null);
      setNameDraft("");
    }
    setSavingName(false);
  }

  const variables = selected ? extractVariables(selected.body_text) : [];
  const canConfirm =
    !!selected &&
    variables.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (selected.header_type !== "image" || !!headerImage);
  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return templates;
    return templates.filter((template) =>
      [
        template.name,
        template.variable_fields?.__internal_name,
        template.body_text,
        template.footer_text,
        template.category,
        template.language,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [query, templates]);

  function categoryLabel(category: MessageTemplate["category"]): string {
    if (category === "Utility") return t("inbox.templateCategoryUtility");
    if (category === "Authentication") return t("inbox.templateCategoryAuthentication");
    return t("inbox.templateCategoryMarketing");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92svh] flex-col border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <LayoutTemplate className="h-4 w-4 text-accent-ink" />
            {selected ? templateDisplayName(selected) : t("inbox.sendTemplate")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {selected ? t("inbox.variables") : t("inbox.templates")}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {!loading && templates.length > 0 ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("inbox.searchTemplates")}
                  aria-label={t("inbox.searchTemplates")}
                  className="border-border bg-background pl-9 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ) : null}

            <div
              ref={listRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
            >
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-accent-ink" />
                </div>
              ) : templates.length === 0 ? (
                <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                  <p className="text-sm text-foreground">
                    {t("inbox.noApprovedTemplates")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("inbox.syncTemplatesHint")}
                  </p>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="rounded-lg border border-border bg-background/50 p-8 text-center">
                  <p className="text-sm text-foreground">
                    {t("inbox.noTemplateResults")}
                  </p>
                </div>
              ) : (
                filteredTemplates.map((tpl) => {
                  const autoOnly = hasDynamicUrlButton(tpl);
                  const templateVariables = extractVariables(tpl.body_text);
                  const templateButtons = getTemplateButtons(tpl);
                  return (
                    <article
                      key={tpl.id}
                      className={cn(
                        "overflow-hidden rounded-xl border border-border bg-background/60 transition-colors",
                        !autoOnly && "hover:border-primary/40",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          {editingNameId === tpl.id ? (
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={nameDraft}
                                onChange={(event) => setNameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void saveDisplayName(tpl);
                                  if (event.key === "Escape") setEditingNameId(null);
                                }}
                                placeholder={readableTemplateName(tpl.name)}
                                aria-label={t("inbox.templateInternalName")}
                                className="h-8 w-64 max-w-full border-border bg-background text-sm"
                                autoFocus
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={savingName}
                                onClick={() => void saveDisplayName(tpl)}
                                aria-label={t("inbox.saveTemplateName")}
                              >
                                {savingName ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingNameId(null)}
                                aria-label={t("inbox.cancelTemplateName")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-foreground">
                                {templateDisplayName(tpl)}
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingNameId(tpl.id);
                                  setNameDraft(tpl.variable_fields?.__internal_name ?? "");
                                }}
                                aria-label={t("inbox.editTemplateName")}
                                className="h-7 px-2 text-[11px] text-muted-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t("inbox.renameTemplate")}
                              </Button>
                            </div>
                          )}
                          {tpl.variable_fields?.__internal_name ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {tpl.name}
                            </p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge className="border border-primary/30 bg-primary/15 text-[10px] text-accent-ink">
                              {categoryLabel(tpl.category)}
                            </Badge>
                            {tpl.language ? (
                              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                                {tpl.language}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={autoOnly}
                          onClick={() => pickTemplate(tpl)}
                          className="h-8 shrink-0 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                        >
                          {templateVariables.length > 0 || tpl.header_type === "image"
                            ? t("inbox.continueTemplate")
                            : t("inbox.send")}
                        </Button>
                      </div>

                      <div className="border-t border-border bg-[#efeae2] p-3 dark:bg-[#0b141a]">
                        <div className="ml-auto max-w-[92%] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
                          {tpl.header_type === "image" ? (
                            <div className="flex h-32 items-center justify-center bg-black/5 text-[#667781] dark:bg-black/20 dark:text-[#aebac1]">
                              <div className="text-center">
                                <ImagePlus className="mx-auto h-6 w-6" />
                                <p className="mt-1 text-xs">
                                  {t("inbox.templateCustomImage")}
                                </p>
                              </div>
                            </div>
                          ) : null}
                          <div className="px-3 py-2.5">
                            {tpl.header_type === "text" && tpl.header_content ? (
                              <p className="mb-1 whitespace-pre-wrap text-sm font-semibold [overflow-wrap:anywhere]">
                                {tpl.header_content}
                              </p>
                            ) : null}
                            <p className="whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]">
                              {tpl.body_text}
                            </p>
                            {tpl.footer_text ? (
                              <p className="mt-1.5 whitespace-pre-wrap text-xs text-[#667781] dark:text-[#aebac1]">
                                {tpl.footer_text}
                              </p>
                            ) : null}
                          </div>
                          {templateButtons.length > 0 ? (
                            <div className="border-t border-black/10 dark:border-white/10">
                              {templateButtons.map((button, index) => (
                                <div
                                  key={`${button.type}-${button.text}-${index}`}
                                  className={cn(
                                    "px-3 py-2 text-center text-xs font-medium text-[#027eb5] dark:text-[#53bdeb]",
                                    index > 0 &&
                                      "border-t border-black/10 dark:border-white/10",
                                  )}
                                >
                                  {button.text}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {autoOnly ? (
                        <p className="border-t border-border px-4 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                          {t("inbox.templateAutoOnly")}
                        </p>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[70svh] space-y-3 overflow-y-auto">
            <div className="rounded-xl border border-border bg-[#efeae2] p-3 dark:bg-[#0b141a]">
              <div className="ml-auto max-w-[92%] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
                {selected.header_type === "image" ? (
                  headerPreviewUrl ? (
                    <div
                      role="img"
                      aria-label={headerImage?.name ?? t("inbox.templateCustomImage")}
                      className="h-52 bg-cover bg-center"
                      style={{ backgroundImage: `url(${headerPreviewUrl})` }}
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center bg-black/5 text-[#667781] dark:bg-black/20 dark:text-[#aebac1]">
                      <ImagePlus className="h-8 w-8" />
                    </div>
                  )
                ) : null}
                <div className="px-3 py-2.5">
                  <p className="whitespace-pre-wrap leading-5 [overflow-wrap:anywhere]">
                    {renderBodyPreview(selected.body_text, params)}
                  </p>
                  {selected.footer_text ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs text-[#667781] dark:text-[#aebac1]">
                      {selected.footer_text}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            {selected.header_type === "image" ? (
              <div className="space-y-1.5">
                <Label htmlFor="template-header-image" className="text-xs text-foreground">
                  {t("inbox.templateImage")}
                </Label>
                <Input
                  id="template-header-image"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => chooseHeaderImage(event.target.files?.[0] ?? null)}
                  className="border-border bg-muted text-foreground file:text-foreground"
                />
                {headerImage ? (
                  <p className="text-xs text-muted-foreground">{headerImage.name}</p>
                ) : null}
                {headerImageError ? (
                  <p className="text-xs text-destructive">{headerImageError}</p>
                ) : null}
              </div>
            ) : null}
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
                  <Textarea
                    value={params[i] ?? ""}
                    placeholder={sample || ""}
                    onChange={(e) => {
                      const next = [...params];
                      next[i] = e.target.value;
                      setParams(next);
                    }}
                    rows={3}
                    className="min-h-20 resize-y border-border bg-muted text-foreground placeholder:text-muted-foreground"
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
                  setHeaderImage(null);
                  setHeaderImageError(null);
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
