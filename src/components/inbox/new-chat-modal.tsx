"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
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

interface ApprovedTemplate {
  name: string;
  language: string;
  body_text: string;
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

export function NewChatModal({
  open,
  onOpenChange,
  onConversationCreated,
}: NewChatModalProps) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();

  const [step, setStep] = useState<"phone" | "compose">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [windowOpen, setWindowOpen] = useState(false);
  const [text, setText] = useState("");
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("phone");
    setPhone("");
    setName("");
    setWindowOpen(false);
    setText("");
    setTemplates([]);
    setTemplateName("");
    setParams([]);
    setBusy(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function loadTemplates() {
    const supabase = createClient();
    const { data } = await supabase
      .from("message_templates")
      .select("name, language, body_text, status")
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
      if (!payload.window_open) await loadTemplates();
      setStep("compose");
    } finally {
      setBusy(false);
    }
  }

  const selectedTemplate = templates.find((tpl) => tpl.name === templateName);
  const varCount = selectedTemplate ? countVars(selectedTemplate.body_text) : 0;

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
        body = {
          ...base,
          template_name: selectedTemplate.name,
          template_language: selectedTemplate.language,
          template_params: filled,
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
      <DialogContent showCloseButton>
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
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("inbox.newChatTemplate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((tpl) => (
                        <SelectItem key={`${tpl.name}:${tpl.language}`} value={tpl.name}>
                          {tpl.name}
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
              disabled={busy || (!windowOpen && templates.length === 0)}
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
