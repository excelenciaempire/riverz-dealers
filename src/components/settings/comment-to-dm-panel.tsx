"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, MoreHorizontal, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * Comentario → DM: la regla que el comercio escribe a mano. Vive en la página
 * Comentarios, debajo del interruptor de la IA, porque son las dos únicas cosas
 * que pueden atender un comentario y la regla manda sobre la IA.
 *
 * La lista es una lista —filas separadas por una línea, no tarjetas— y cada
 * fila se lee como una frase: dónde, con qué palabras, qué hace. Un solo sitio
 * donde tocar para editar; el resto (activar, eliminar) al margen.
 *
 * El editor pide lo que hace falta y nada más. La coincidencia exacta, el
 * distinguir mayúsculas y la prioridad se guardan pero no se preguntan: son
 * decisiones que nadie que vende toma, y ocupaban un tercio del formulario.
 * A cambio, la vista previa muestra el mensaje tal cual va a salir —incluido el
 * enlace, que el DM manda como texto (`composeDm`)—, así que no hay que
 * explicarlo con un hint.
 *
 * CRUD contra /api/comment-to-dm; el motor de envío es
 * src/lib/comment-to-dm/engine.ts.
 */

/** Dónde escucha una regla: una red, o las dos (migración 203). */
type CommentChannel = "ig_comment" | "fb_comment" | "both";

interface RuleRow {
  id: string;
  name: string;
  channel: CommentChannel;
  post_id: string | null;
  keywords: string[];
  match_type: "contains" | "exact";
  case_sensitive: boolean;
  public_reply_enabled: boolean;
  public_reply_templates: string[];
  dm_message: string;
  dm_button_label: string | null;
  dm_button_url: string | null;
  dm_attachment_url: string | null;
  dm_attachment_type: string | null;
  is_active: boolean;
  priority: number;
  dm_sent_count: number;
  dm_failed_count: number;
}

export function CommentToDmPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const { workspace } = useWorkspace();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = workspace?.id ? `?workspace_id=${workspace.id}` : "";
    const res = await fetch(`/api/comment-to-dm${qs}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? t("settings.rulesLoadError"));
      setRules([]);
      return;
    }
    setRules((json.rules ?? []) as RuleRow[]);
  }, [t, workspace?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(rule: RuleRow, next: boolean) {
    if (!workspace?.id) {
      toast.error(t("settings.workspaceUnavailable"));
      return;
    }
    setRules(
      (prev) =>
        prev?.map((r) => (r.id === rule.id ? { ...r, is_active: next } : r)) ??
        prev,
    );
    const res = await fetchWithCsrf("/api/comment-to-dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rule, id: rule.id, workspace_id: workspace.id, is_active: next }),
    });
    if (!res.ok) {
      setRules(
        (prev) =>
          prev?.map((r) =>
            r.id === rule.id ? { ...r, is_active: !next } : r,
          ) ?? prev,
      );
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? t("settings.couldNotUpdate"));
    }
  }

  async function handleDelete(id: string) {
    if (!workspace?.id) {
      toast.error(t("settings.workspaceUnavailable"));
      return;
    }
    setDeletingId(id);
    const res = await fetchWithCsrf(
      `/api/comment-to-dm?id=${id}&workspace_id=${workspace.id}`,
      { method: "DELETE" },
    );
    setDeletingId(null);
    setConfirmingId(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? t("settings.couldNotDelete"));
      return;
    }
    setRules((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    toast.success(t("settings.ruleDeleted"));
  }

  return (
    <section className="space-y-1">
      <div className="app-section-head">
        <div>
          <h2 className="text-[15px] font-medium text-foreground">
            {t("settings.c2dmRulesTitle")}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("settings.c2dmRulesHint")}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          {t("settings.c2dmNew")}
        </Button>
      </div>

      {rules === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : rules.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          {t("settings.c2dmEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rules.map((rule) => (
            <RuleLine
              key={rule.id}
              rule={rule}
              confirming={confirmingId === rule.id}
              deleting={deletingId === rule.id}
              onEdit={() => setEditing(rule)}
              onToggle={(v) => toggleActive(rule, v)}
              onAskDelete={() => setConfirmingId(rule.id)}
              onCancelDelete={() => setConfirmingId(null)}
              onDelete={() => handleDelete(rule.id)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          workspaceId={workspace?.id ?? null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

/** Una fila = una frase. Dónde · con qué palabras · qué hace. */
function RuleLine({
  rule,
  confirming,
  deleting,
  onEdit,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  rule: RuleRow;
  confirming: boolean;
  deleting: boolean;
  onEdit: () => void;
  onToggle: (next: boolean) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const summary = [
    rule.channel === "both"
      ? t("settings.c2dmBothComments")
      : rule.channel === "ig_comment"
        ? "Instagram"
        : "Facebook",
    rule.keywords.length > 0
      ? rule.keywords.map((k) => `«${k}»`).join(", ")
      : t("settings.c2dmKeywordsAny"),
    rule.public_reply_enabled
      ? t("settings.c2dmActionReplyAndDm")
      : t("settings.c2dmActionDmOnly"),
    ...(rule.post_id ? [t("settings.c2dmOnePostOnly")] : []),
  ].join(" · ");

  return (
    <li className="flex items-center gap-4 py-3.5">
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              rule.is_active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {rule.name}
          </span>
          {rule.dm_sent_count > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {t("settings.c2dmDmSentCount", { count: rule.dm_sent_count })}
            </span>
          )}
          {/* Los rechazos de Meta, sólo si los hay. Una regla que dispara y
              nunca entrega se leía igual que una que nadie activó. */}
          {rule.dm_failed_count > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-destructive">
              {t("settings.c2dmDmFailedCount", { count: rule.dm_failed_count })}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {summary}
        </span>
      </button>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-3 text-xs">
          <button
            type="button"
            onClick={onCancelDelete}
            className="text-muted-foreground hover:text-foreground"
          >
            {t("settings.cancel")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 font-medium text-destructive disabled:opacity-50"
          >
            {deleting && <Loader2 className="size-3 animate-spin" />}
            {t("settings.deleteAction")}
          </button>
        </span>
      ) : (
        <>
          <Switch
            checked={rule.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={
              rule.is_active
                ? t("settings.pauseRule")
                : t("settings.activateRule")
            }
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("settings.c2dmRuleOptions")}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-card">
              <DropdownMenuItem onClick={onEdit}>
                {t("settings.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onAskDelete}>
                {t("settings.deleteAction")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </li>
  );
}

interface RuleDraft {
  name: string;
  channel: CommentChannel;
  post_id: string;
  keywords: string;
  public_reply_templates: string;
  dm_message: string;
  dm_button_label: string;
  dm_button_url: string;
  dm_attachment_url: string;
}

function RuleEditor({
  rule,
  workspaceId,
  onClose,
  onSaved,
}: {
  rule: RuleRow | null;
  workspaceId: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const channelLabels = useMemo<Record<string, string>>(
    () => ({
      ig_comment: t("settings.c2dmIgComment"),
      fb_comment: t("settings.c2dmFbComment"),
      both: t("settings.c2dmBothComments"),
    }),
    [t],
  );
  const [draft, setDraft] = useState<RuleDraft>(() => ({
    name: rule?.name ?? "",
    channel: rule?.channel ?? "ig_comment",
    post_id: rule?.post_id ?? "",
    keywords: (rule?.keywords ?? []).join(", "),
    public_reply_templates: (rule?.public_reply_templates ?? []).join("\n"),
    dm_message: rule?.dm_message ?? "",
    dm_button_label: rule?.dm_button_label ?? "",
    dm_button_url: rule?.dm_button_url ?? "",
    dm_attachment_url: rule?.dm_attachment_url ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function submit() {
    if (!draft.name.trim()) {
      toast.error(t("settings.giveItAName"));
      return;
    }
    if (!draft.dm_message.trim()) {
      toast.error(t("settings.c2dmDmMessageRequired"));
      return;
    }
    if (!workspaceId) {
      toast.error(t("settings.workspaceUnavailable"));
      return;
    }
    setSaving(true);
    const res = await fetchWithCsrf("/api/comment-to-dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: rule?.id,
        workspace_id: workspaceId,
        name: draft.name.trim(),
        channel: draft.channel,
        post_id: draft.post_id.trim() || null,
        keywords: draft.keywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        // No se preguntan: se preservan al editar y son el default al crear.
        match_type: rule?.match_type ?? "contains",
        case_sensitive: rule?.case_sensitive ?? false,
        priority: rule?.priority ?? 100,
        // Un solo control en vez de dos: escribir una respuesta ES pedir que
        // se publique. El interruptor aparte se podía dejar encendido con la
        // caja vacía, y entonces la regla no publicaba nada.
        public_reply_enabled: true,
        public_reply_templates: draft.public_reply_templates
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        dm_message: draft.dm_message.trim(),
        dm_button_label: draft.dm_button_label.trim() || null,
        dm_button_url: draft.dm_button_url.trim() || null,
        // El tipo lo deduce el servidor por la extensión: nadie que pega el
        // enlace de su catálogo debería elegir "archivo" en un menú.
        dm_attachment_url: draft.dm_attachment_url.trim() || null,
        // Una regla nueva nace encendida; apagarla es cosa del interruptor de
        // la lista, que es donde se ve el estado.
        is_active: rule?.is_active ?? true,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? t("settings.couldNotSave"));
      return;
    }
    toast.success(rule ? t("settings.c2dmUpdated") : t("settings.c2dmCreated"));
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <DialogTitle className="border-b border-border px-5 py-4">
          {rule ? t("settings.editRule") : t("settings.c2dmNew")}
        </DialogTitle>

        <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="space-y-5">
            <Field label={t("settings.ruleNameLabel")}>
              <Input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("settings.ruleNamePlaceholder")}
                autoFocus
              />
            </Field>

            <div className="space-y-3">
              <p className="app-eyebrow">{t("settings.c2dmSectionWhen")}</p>

              <Select
                value={draft.channel}
                onValueChange={(v) => {
                  if (typeof v !== "string") return;
                  set("channel", v as CommentChannel);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue labels={channelLabels} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ig_comment">
                    {t("settings.c2dmIgComment")}
                  </SelectItem>
                  <SelectItem value="fb_comment">
                    {t("settings.c2dmFbComment")}
                  </SelectItem>
                  <SelectItem value="both">
                    {t("settings.c2dmBothComments")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Field
                label={t("settings.c2dmKeywordsLabel")}
                hint={t("settings.c2dmKeywordsHint")}
              >
                <Input
                  value={draft.keywords}
                  onChange={(e) => set("keywords", e.target.value)}
                  placeholder={t("settings.c2dmKeywordsPlaceholder")}
                />
              </Field>

              <Field label={t("settings.c2dmPostLabel")}>
                <Input
                  value={draft.post_id}
                  onChange={(e) => set("post_id", e.target.value)}
                  placeholder={t("settings.c2dmPostPlaceholder")}
                  className="font-mono text-xs"
                />
              </Field>
            </div>

            <div className="space-y-3">
              <p className="app-eyebrow">{t("settings.c2dmSectionWhat")}</p>

              <Field label={t("settings.c2dmDmMessageLabel")}>
                <Textarea
                  value={draft.dm_message}
                  onChange={(e) => set("dm_message", e.target.value)}
                  placeholder={t("settings.c2dmDmMessagePlaceholder")}
                  rows={3}
                />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("settings.c2dmButtonLabelLabel")}>
                  <Input
                    value={draft.dm_button_label}
                    onChange={(e) => set("dm_button_label", e.target.value)}
                  />
                </Field>
                <Field label={t("settings.c2dmButtonUrlLabel")}>
                  <Input
                    value={draft.dm_button_url}
                    onChange={(e) => set("dm_button_url", e.target.value)}
                    placeholder="https://"
                    className="font-mono text-xs"
                  />
                </Field>
              </div>

              <Field
                label={t("settings.c2dmAttachmentLabel")}
                hint={t("settings.c2dmAttachmentHint")}
              >
                <Input
                  value={draft.dm_attachment_url}
                  onChange={(e) => set("dm_attachment_url", e.target.value)}
                  placeholder="https://"
                  className="font-mono text-xs"
                />
              </Field>

              {/* Un solo control: lo que escribas acá se publica bajo el
                  comentario; vacío, la regla sólo manda el DM. El interruptor
                  aparte se podía dejar encendido sin nada que publicar. */}
              <Field
                label={t("settings.c2dmPublicRepliesLabel")}
                hint={t("settings.c2dmPublicRepliesHint")}
              >
                <Textarea
                  value={draft.public_reply_templates}
                  onChange={(e) => set("public_reply_templates", e.target.value)}
                  rows={2}
                />
              </Field>
            </div>
          </div>

          <RulePreview draft={draft} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t("settings.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * El mensaje tal cual sale. El enlace se pinta como lo compone el motor
 * (`composeDm`): texto plano al final, porque la respuesta privada de Meta no
 * admite botones.
 */
/** El nombre del archivo, que es lo único legible de una URL larga. */
function fileNameFrom(url: string): string {
  const clean = url.trim().split("?")[0];
  return clean.split("/").filter(Boolean).pop() ?? clean;
}

function RulePreview({ draft }: { draft: RuleDraft }) {
  const t = useT();
  const publicText = draft.public_reply_templates
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  const url = draft.dm_button_url.trim();
  const label = draft.dm_button_label.trim();

  return (
    <aside className="h-fit rounded-xl border border-border bg-muted/30 p-3.5 sm:sticky sm:top-0">
      <p className="app-eyebrow">{t("settings.c2dmPreview")}</p>

      <div className="mt-3 space-y-3">
        {publicText && (
          <div>
            <p className="text-[10px] text-muted-foreground">
              {t("settings.c2dmPreviewPublic")}
            </p>
            <p className="mt-1 rounded-lg rounded-tl-sm border border-border bg-card px-3 py-2 text-xs break-words text-foreground">
              {publicText}
            </p>
          </div>
        )}

        <div>
          <p className="text-[10px] text-muted-foreground">
            {t("settings.c2dmPreviewDm")}
          </p>
          <div className="mt-1 rounded-lg rounded-tl-sm bg-accent/60 px-3 py-2 text-xs whitespace-pre-wrap text-foreground">
            {draft.dm_message.trim() || (
              <span className="text-muted-foreground">—</span>
            )}
            {url && (
              <span className="mt-2 block break-all text-accent-ink">
                👉 {label ? `${label}: ` : ""}
                {url}
              </span>
            )}
            {draft.dm_attachment_url.trim() && (
              <span className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Paperclip className="size-3 shrink-0" />
                <span className="truncate">
                  {fileNameFrom(draft.dm_attachment_url)}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
