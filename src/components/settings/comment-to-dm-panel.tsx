"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, X, MessageSquareReply } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/**
 * Comentario → DM (auto-DM on IG/FB comments) — ManyChat's signature growth
 * tool. Each rule watches a comment surface (and optionally one post), matches
 * keywords (or any comment), posts a public reply, and DMs the commenter.
 * CRUD against /api/comment-to-dm; the send engine is server-side
 * (src/lib/comment-to-dm/engine.ts).
 */

type CommentChannel = "ig_comment" | "fb_comment";

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
  is_active: boolean;
  priority: number;
  dm_sent_count: number;
}

export function CommentToDmPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const { workspace } = useWorkspace();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
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
    if (!confirm(t("settings.deleteRuleConfirm"))) return;
    setDeletingId(id);
    const res = await fetchWithCsrf(
      `/api/comment-to-dm?id=${id}&workspace_id=${workspace.id}`,
      { method: "DELETE" },
    );
    setDeletingId(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? t("settings.couldNotDelete"));
      return;
    }
    setRules((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    toast.success(t("settings.ruleDeleted"));
  }

  if (rules === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Subsección: vive dentro de "Automatización" del hub de Instagram, así
          que su encabezado no debe competir con el de la sección. */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.c2dmTitle")}
          </h3>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            {t("settings.c2dmDescription")}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" />
          {t("settings.c2dmNew")}
        </Button>
      </div>

      {rules.length === 0 ? (
        // El botón de "Nueva regla" ya está arriba: repetirlo aquí era ofrecer
        // dos caminos para lo mismo.
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
          <MessageSquareReply className="size-4 shrink-0 text-accent-ink" />
          {t("settings.c2dmNoneYet")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <RuleRowCard
              key={rule.id}
              rule={rule}
              onEdit={() => setEditing(rule)}
              onToggle={(v) => toggleActive(rule, v)}
              onDelete={() => handleDelete(rule.id)}
              deleting={deletingId === rule.id}
            />
          ))}
        </ul>
      )}

      {editing && (
        <RuleEditorModal
          rule={editing === "new" ? null : editing}
          workspaceId={workspace?.id ?? null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function RuleRowCard({
  rule,
  onEdit,
  onToggle,
  onDelete,
  deleting,
}: {
  rule: RuleRow;
  onEdit: () => void;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const t = useT();
  const channelText =
    rule.channel === "ig_comment"
      ? t("settings.c2dmIgComment")
      : t("settings.c2dmFbComment");
  const keywordText =
    rule.keywords.length > 0
      ? rule.keywords.join(", ")
      : t("settings.c2dmKeywordsAny");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
        <MessageSquareReply className="size-4" />
      </div>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {rule.name}
          </p>
          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {channelText}
          </span>
          {rule.dm_sent_count > 0 && (
            <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("settings.c2dmDmSentCount", { count: rule.dm_sent_count })}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {keywordText}
        </p>
      </button>
      <Switch
        checked={rule.is_active}
        onCheckedChange={(v) => onToggle(!!v)}
        aria-label={rule.is_active ? t("settings.pauseRule") : t("settings.activateRule")}
      />
      <button
        onClick={onEdit}
        title={t("settings.edit")}
        className="rounded p-1.5 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Pencil className="size-4" />
      </button>
      <button
        onClick={onDelete}
        disabled={deleting}
        title={t("settings.deleteAction")}
        className="rounded p-1.5 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:bg-accent hover:text-red-400 disabled:opacity-50"
      >
        {deleting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </button>
    </li>
  );
}

interface RuleDraft {
  name: string;
  channel: CommentChannel;
  post_id: string;
  keywords: string;
  match_type: "contains" | "exact";
  case_sensitive: boolean;
  public_reply_enabled: boolean;
  public_reply_templates: string;
  dm_message: string;
  dm_button_label: string;
  dm_button_url: string;
  is_active: boolean;
  priority: number;
}

function RuleEditorModal({
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
    }),
    [t],
  );
  const matchLabels = useMemo<Record<string, string>>(
    () => ({
      contains: t("settings.c2dmMatchContains"),
      exact: t("settings.c2dmMatchExact"),
    }),
    [t],
  );
  const [draft, setDraft] = useState<RuleDraft>(() => ({
    name: rule?.name ?? "",
    channel: rule?.channel ?? "ig_comment",
    post_id: rule?.post_id ?? "",
    keywords: (rule?.keywords ?? []).join(", "),
    match_type: rule?.match_type ?? "contains",
    case_sensitive: rule?.case_sensitive ?? false,
    public_reply_enabled: rule?.public_reply_enabled ?? true,
    public_reply_templates: (rule?.public_reply_templates ?? []).join("\n"),
    dm_message: rule?.dm_message ?? "",
    dm_button_label: rule?.dm_button_label ?? "",
    dm_button_url: rule?.dm_button_url ?? "",
    is_active: rule?.is_active ?? true,
    priority: rule?.priority ?? 100,
  }));
  const [saving, setSaving] = useState(false);

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
        match_type: draft.match_type,
        case_sensitive: draft.case_sensitive,
        public_reply_enabled: draft.public_reply_enabled,
        public_reply_templates: draft.public_reply_templates
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        dm_message: draft.dm_message.trim(),
        dm_button_label: draft.dm_button_label.trim() || null,
        dm_button_url: draft.dm_button_url.trim() || null,
        is_active: draft.is_active,
        priority: draft.priority,
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
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            {rule ? t("settings.editRule") : t("settings.c2dmNew")}
          </h3>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("settings.close")}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="c2dm-name" className="text-xs text-foreground">
              {t("settings.ruleNameLabel")}
            </Label>
            <Input
              id="c2dm-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t("settings.ruleNamePlaceholder")}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.c2dmChannelLabel")}
              </Label>
              <Select
                value={draft.channel}
                onValueChange={(v) => {
                  if (typeof v !== "string") return;
                  setDraft((d) => ({ ...d, channel: v as CommentChannel }));
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue labels={channelLabels} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ig_comment">
                    {t("settings.c2dmIgComment")}
                  </SelectItem>
                  <SelectItem value="fb_comment">
                    {t("settings.c2dmFbComment")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.c2dmMatchTypeLabel")}
              </Label>
              <Select
                value={draft.match_type}
                onValueChange={(v) => {
                  if (typeof v !== "string") return;
                  setDraft((d) => ({
                    ...d,
                    match_type: v as "contains" | "exact",
                  }));
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue labels={matchLabels} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">
                    {t("settings.c2dmMatchContains")}
                  </SelectItem>
                  <SelectItem value="exact">
                    {t("settings.c2dmMatchExact")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-foreground">
              {t("settings.c2dmKeywordsLabel")}
            </Label>
            <Input
              value={draft.keywords}
              onChange={(e) =>
                setDraft((d) => ({ ...d, keywords: e.target.value }))
              }
              placeholder={t("settings.c2dmKeywordsPlaceholder")}
              className="mt-1"
            />
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("settings.c2dmKeywordsHint")}
            </p>
          </div>

          <div>
            <Label className="text-xs text-foreground">
              {t("settings.c2dmPostIdLabel")}
            </Label>
            <Input
              value={draft.post_id}
              onChange={(e) =>
                setDraft((d) => ({ ...d, post_id: e.target.value }))
              }
              className="mt-1 font-mono text-xs"
            />
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {t("settings.c2dmPostIdHint")}
            </p>
          </div>

          <div>
            <Label className="text-xs text-foreground">
              {t("settings.c2dmDmMessageLabel")}
            </Label>
            <Textarea
              value={draft.dm_message}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dm_message: e.target.value }))
              }
              placeholder={t("settings.c2dmDmMessagePlaceholder")}
              rows={3}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.c2dmButtonLabelLabel")}
              </Label>
              <Input
                value={draft.dm_button_label}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dm_button_label: e.target.value }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.c2dmButtonUrlLabel")}
              </Label>
              <Input
                value={draft.dm_button_url}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dm_button_url: e.target.value }))
                }
                placeholder="https://"
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
            <span className="text-xs text-foreground">
              {t("settings.c2dmPublicReplyEnabled")}
            </span>
            <Switch
              checked={draft.public_reply_enabled}
              onCheckedChange={(v) =>
                setDraft((d) => ({ ...d, public_reply_enabled: !!v }))
              }
            />
          </div>
          {draft.public_reply_enabled && (
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.c2dmPublicReplyTemplatesLabel")}
              </Label>
              <Textarea
                value={draft.public_reply_templates}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    public_reply_templates: e.target.value,
                  }))
                }
                rows={2}
                className="mt-1"
              />
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t("settings.c2dmPublicReplyHint")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.rulePriorityLabel")}
              </Label>
              <Input
                type="number"
                value={draft.priority}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    priority: Number(e.target.value) || 0,
                  }))
                }
                className="mt-1"
              />
            </div>
            <div className="flex items-end justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs text-foreground">
                {t("settings.c2dmActiveLabel")}
              </span>
              <Switch
                checked={draft.is_active}
                onCheckedChange={(v) =>
                  setDraft((d) => ({ ...d, is_active: !!v }))
                }
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.case_sensitive}
              onChange={(e) =>
                setDraft((d) => ({ ...d, case_sensitive: e.target.checked }))
              }
            />
            {t("settings.c2dmCaseSensitive")}
          </label>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          >
            {t("settings.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3 animate-spin" />}
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
