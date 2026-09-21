"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import { useWorkspace } from '@/hooks/use-workspace';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/types";
import { dynamicUrlButtons, manualButtonValue, validBodyParams } from '@/lib/whatsapp/manual-template';
import { cn } from "@/lib/utils";

interface ApprovedTemplate {
  id: string;
  buttons: unknown;
  name: string;
  language: string;
  body_text: string;
  header_type: "text" | "image" | "video" | "document" | null;
}

interface NewChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated: (conversation: Conversation) => void;
}

/** Count distinct {{1}}, {{2}}… placeholders in a template body. */
function countVars(body: string): number {
  const nums = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return nums.size;
}

/** Fill {{n}} placeholders with params for a human-readable thread preview. */
function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

function imageFromFiles(files: FileList | File[]): File | null {
  const list = Array.from(files);
  return (
    list.find((file) => ["image/jpeg", "image/png"].includes(file.type)) ??
    list[0] ??
    null
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} MB`;
}

export function NewChatModal({
  open,
  onOpenChange,
  onConversationCreated,
}: NewChatModalProps) {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [step, setStep] = useState<"phone" | "compose">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [windowOpen, setWindowOpen] = useState(false);
  const [text, setText] = useState("");
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [buttonLinks, setButtonLinks] = useState<Record<string, string>>({});
  const [conversationId, setConversationId] = useState("");
  const [headerImage, setHeaderImage] = useState<File | null>(null);
  const [headerImageError, setHeaderImageError] = useState<string | null>(null);
  const [draggingHeaderImage, setDraggingHeaderImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const headerImageInputRef = useRef<HTMLInputElement>(null);

  const headerPreviewUrl = useMemo(
    () => (headerImage ? URL.createObjectURL(headerImage) : null),
    [headerImage],
  );

  useEffect(() => {
    if (!headerPreviewUrl) return;
    return () => URL.revokeObjectURL(headerPreviewUrl);
  }, [headerPreviewUrl]);

  function reset() {
    setStep("phone");
    setPhone("");
    setName("");
    setWindowOpen(false);
    setText("");
    setTemplates([]);
    setTemplateName("");
    setParams([]);
    setButtonLinks({});
    setConversationId("");
    setHeaderImage(null);
    setHeaderImageError(null);
    setDraggingHeaderImage(false);
    setBusy(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function loadTemplates() {
    if (!workspace) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("message_templates")
      .select("id, name, language, body_text, status, buttons, header_type")
      .eq('workspace_id', workspace.id)
      .eq("status", "Approved")
      .order("name", { ascending: true });
    setTemplates((data ?? []) as ApprovedTemplate[]);
  }

  async function handleContinue() {
    if (!phone.trim()) {
      toast.error(t("inbox.recipientPhone"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetchWithCsrf("/api/conversations/start-whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), name: name.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t("inbox.newChatFailed", { reason: "" }));
        return;
      }
      setWindowOpen(Boolean(payload.window_open));
      setConversationId(String(payload.conversation?.id ?? ""));
      if (!payload.window_open) await loadTemplates();
      setStep("compose");
    } finally {
      setBusy(false);
    }
  }

  const selectedTemplate = templates.find((tpl) => tpl.id === templateName);
  const urlButtons = dynamicUrlButtons(selectedTemplate?.buttons);
  const varCount = selectedTemplate ? countVars(selectedTemplate.body_text) : 0;

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

  function pasteHeaderImage(event: ClipboardEvent<HTMLDivElement>) {
    if (selectedTemplate?.header_type !== "image") return;
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    const file =
      imageFromFiles(event.clipboardData.files) ?? imageFromFiles(itemFiles);
    if (!file) return;
    event.preventDefault();
    chooseHeaderImage(file);
  }

  function dropHeaderImage(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingHeaderImage(false);
    chooseHeaderImage(imageFromFiles(event.dataTransfer.files));
  }

  function openHeaderImagePicker(event?: KeyboardEvent<HTMLDivElement>) {
    if (event && !["Enter", " "].includes(event.key)) return;
    event?.preventDefault();
    headerImageInputRef.current?.click();
  }

  async function handleSend() {
    setBusy(true);
    try {
      const base = { phone: phone.trim(), name: name.trim() };
      let body: Record<string, unknown>;
      if (windowOpen) {
        if (!text.trim()) {
          toast.error(t("inbox.newChatMessage"));
          return;
        }
        body = { ...base, text: text.trim() };
      } else {
        if (!selectedTemplate) {
          toast.error(t("inbox.newChatTemplate"));
          return;
        }
        const filled = params.slice(0, varCount);
        if (!validBodyParams(selectedTemplate.body_text, filled)) {
          toast.error(t('inbox.templateFieldsRequired'));
          return;
        }
        try {
          for (const button of urlButtons) manualButtonValue(button.url, buttonLinks[button.index]);
        } catch (error) {
          toast.error(t(error instanceof Error ? error.message : 'inbox.templateLinkInvalid'));
          return;
        }
        let templateHeaderImage:
          | { url: string; mime?: string; name?: string; size?: number }
          | undefined;
        if (selectedTemplate.header_type === "image") {
          if (!headerImage) {
            toast.error(t("inbox.templateImageRequired"));
            return;
          }
          if (!conversationId) {
            toast.error(t("inbox.newChatFailed", { reason: "" }));
            return;
          }
          const form = new FormData();
          form.append("file", headerImage);
          form.append("conversation_id", conversationId);
          const upload = await fetchWithCsrf("/api/messages/upload", {
            method: "POST",
            body: form,
          });
          const uploaded = await upload.json().catch(() => ({}));
          if (!upload.ok || !uploaded.url) {
            toast.error(
              uploaded.error || t("inbox.templateImageUploadFailed"),
            );
            return;
          }
          templateHeaderImage = {
            url: String(uploaded.url),
            mime: uploaded.mime ? String(uploaded.mime) : undefined,
            name: uploaded.name ? String(uploaded.name) : headerImage.name,
            size:
              typeof uploaded.size === "number"
                ? uploaded.size
                : headerImage.size,
          };
        }
        body = {
          ...base,
          template_name: selectedTemplate.name,
          template_id: selectedTemplate.id,
          template_button_links: buttonLinks,
          template_language: selectedTemplate.language,
          template_params: filled,
          template_header_image: templateHeaderImage,
          template_preview: fillTemplate(selectedTemplate.body_text, filled),
        };
      }
      const res = await fetchWithCsrf("/api/conversations/start-whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t("inbox.newChatFailed", { reason: "" }));
        return;
      }
      toast.success(t("inbox.newChatSent"));
      if (payload.conversation) onConversationCreated(payload.conversation as Conversation);
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent showCloseButton onPaste={pasteHeaderImage}>
        <DialogHeader>
          <DialogTitle>{t("inbox.newChatTitle")}</DialogTitle>
          <DialogDescription>{t("inbox.newChatDesc")}</DialogDescription>
        </DialogHeader>

        {step === "phone" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("inbox.recipientPhone")}
              </label>
              <Input
                type="tel"
                placeholder="+57 300 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("inbox.recipientName")}
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground ring-1 ring-border/50">
              {windowOpen ? t("inbox.newChatWindowOpen") : t("inbox.newChatNeedsTemplate")}
            </p>

            {windowOpen ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  {t("inbox.newChatMessage")}
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  disabled={busy}
                  className="w-full rounded-lg border border-border bg-muted px-2.5 py-2 text-sm text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                />
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("inbox.newChatNoTemplates")}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t("inbox.newChatTemplate")}
                  </label>
                  <Select
                    value={templateName}
                    onValueChange={(v) => {
                      setTemplateName(v ?? "");
                      setParams([]);
                      setButtonLinks({});
                      setHeaderImage(null);
                      setHeaderImageError(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("inbox.newChatTemplate")}
                        labels={Object.fromEntries(templates.map(tpl => [tpl.id, `${tpl.name} · ${tpl.language}`]))} />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name} · {tpl.language}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedTemplate && (
                  <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground/80">
                    {fillTemplate(selectedTemplate.body_text, params.slice(0, varCount))}
                  </p>
                )}

                {selectedTemplate?.header_type === "image" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("inbox.templateImage")}
                    </label>
                    <input
                      ref={headerImageInputRef}
                      id="new-chat-template-header-image"
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(event) => {
                        chooseHeaderImage(
                          imageFromFiles(event.target.files ?? []),
                        );
                        event.target.value = "";
                      }}
                    />
                    {headerImage ? (
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 p-2.5">
                        {headerPreviewUrl && (
                          <div
                            role="img"
                            aria-label={headerImage.name}
                            className="h-12 w-12 shrink-0 rounded-lg bg-cover bg-center"
                            style={{
                              backgroundImage: `url(${headerPreviewUrl})`,
                            }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {headerImage.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(headerImage.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => headerImageInputRef.current?.click()}
                        >
                          {t("inbox.templateImageChange")}
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("inbox.templateImageRemove")}
                          onClick={() => chooseHeaderImage(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={t("inbox.templateImageSelect")}
                        onClick={() => openHeaderImagePicker()}
                        onKeyDown={openHeaderImagePicker}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setDraggingHeaderImage(true);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                          setDraggingHeaderImage(true);
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node | null,
                            )
                          ) {
                            setDraggingHeaderImage(false);
                          }
                        }}
                        onDrop={dropHeaderImage}
                        className={cn(
                          "cursor-pointer rounded-xl border border-dashed px-5 py-5 text-center outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
                          draggingHeaderImage
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/60",
                        )}
                      >
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-accent-ink">
                          <ImagePlus className="h-5 w-5" />
                        </div>
                        <p className="mt-3 text-sm font-medium text-foreground">
                          {t(
                            draggingHeaderImage
                              ? "inbox.templateImageDropActive"
                              : "inbox.templateImageDrop",
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("inbox.templateImagePaste")}
                        </p>
                        <span className="mt-3 inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground">
                          {t("inbox.templateImageSelect")}
                        </span>
                      </div>
                    )}
                    {headerImageError && (
                      <p className="text-xs text-destructive">
                        {headerImageError}
                      </p>
                    )}
                  </div>
                )}

                {Array.from({ length: varCount }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("inbox.newChatTemplateVar", { n: i + 1 })}
                    </label>
                    <Input
                      value={params[i] ?? ""}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      disabled={busy}
                    />
                  </div>
                ))}
                {urlButtons.map((button) => (
                  <label key={button.index} className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>{t('inbox.templateButtonLink', { button: button.text })}</span>
                    <Input type="url" placeholder="https://…" value={buttonLinks[button.index] ?? ''}
                      onChange={(e) => setButtonLinks((old) => ({ ...old, [button.index]: e.target.value }))}
                      disabled={busy} />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            {t("inbox.cancel")}
          </Button>
          {step === "phone" ? (
            <Button onClick={handleContinue} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("inbox.newChatContinue")}
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={
                busy ||
                (!windowOpen && templates.length === 0) ||
                (!windowOpen &&
                  selectedTemplate?.header_type === "image" &&
                  !headerImage)
              }
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {busy ? t("inbox.newChatSending") : t("inbox.newChatSend")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
