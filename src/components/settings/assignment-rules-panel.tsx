"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  X,
  Workflow,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CHANNELS, type Channel } from "@/types";
import { channelLabel } from "@/lib/channels/display";
import { cn } from "@/lib/utils";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useWorkspace } from "@/hooks/use-workspace";
import { useT } from "@/hooks/use-locale";

/**
 * Editor de reglas de asignación automática. La fila más importante de
 * cada regla es:
 *   - kind: cómo se elige el agente (round_robin, by_tag, by_keyword,
 *     by_channel).
 *   - channel: a qué canal aplica la regla. `null` = cualquiera. El
 *     filtro vive en una columna propia (mig 036) para que un
 *     round_robin pueda restringirse a un canal sin convertirse en
 *     by_channel.
 *
 * Los detalles específicos de cada kind (agent_ids, tag_id, keyword)
 * viven en `config` y se editan en el panel inline correspondiente.
 */

type RuleKind = "round_robin" | "by_tag" | "by_channel" | "by_keyword";

interface RuleRow {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  kind: RuleKind;
  channel: string | null;
  config: Record<string, unknown>;
  created_at: string;
}

// i18n keys (settings.*) per rule kind, resolved at render via t().
const KIND_LABEL_KEY: Record<RuleKind, string> = {
  round_robin: "settings.ruleKindRoundRobin",
  by_tag: "settings.ruleKindByTag",
  by_channel: "settings.ruleKindByChannel",
  by_keyword: "settings.ruleKindByKeyword",
};

const KIND_HINT_KEY: Record<RuleKind, string> = {
  round_robin: "settings.ruleHintRoundRobin",
  by_tag: "settings.ruleHintByTag",
  by_channel: "settings.ruleHintByChannel",
  by_keyword: "settings.ruleHintByKeyword",
};

export function AssignmentRulesPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const { workspace } = useWorkspace();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/inbox/assignment-rules");
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? t("settings.rulesLoadError"));
      setRules([]);
      return;
    }
    setRules((json.rules ?? []) as RuleRow[]);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(rule: RuleRow, next: boolean) {
    if (!workspace?.id) {
      toast.error(t("settings.workspaceUnavailable"));
      return;
    }
    setRules((prev) =>
      prev?.map((r) => (r.id === rule.id ? { ...r, is_active: next } : r)) ??
      prev,
    );
    const res = await fetchWithCsrf("/api/inbox/assignment-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: rule.id,
        workspace_id: workspace.id,
        name: rule.name,
        is_active: next,
        priority: rule.priority,
        kind: rule.kind,
        channel: rule.channel,
        config: rule.config,
      }),
    });
    if (!res.ok) {
      setRules((prev) =>
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
      `/api/inbox/assignment-rules?id=${id}&workspace_id=${workspace.id}`,
      {
        method: "DELETE",
      },
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {t("settings.assignmentRules")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.assignmentRulesDescription")}
          </p>
        </div>
        <Button
          onClick={() => setEditing("new")}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          {t("settings.newRule")}
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-accent-ink">
            <GitBranch className="size-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            {t("settings.noRulesYet")}
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {t("settings.noRulesYetDescription")}
          </p>
          <Button
            onClick={() => setEditing("new")}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t("settings.createFirstRule")}
          </Button>
        </div>
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
  const channelLabelText = rule.channel
    ? channelLabel(rule.channel as Channel, t)
    : t("settings.anyChannel");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
        <Workflow className="size-4" />
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {rule.name}
          </p>
          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t(KIND_LABEL_KEY[rule.kind])}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {t("settings.rulePriorityChannel", {
            priority: rule.priority,
            channel: channelLabelText,
          })}
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
  is_active: boolean;
  priority: number;
  kind: RuleKind;
  channel: string; // "" = cualquiera
  config: Record<string, unknown>;
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
  // Mapa para SelectValue: el componente base-ui imprime el value crudo si
  // no le damos children o labels. Cubrimos el sentinel "any" + cada canal.
  const channelSelectLabels = useMemo<Record<string, string>>(
    () => ({
      any: t("settings.anyOption"),
      ...Object.fromEntries(CHANNELS.map((c) => [c, channelLabel(c, t)])),
    }),
    [t],
  );
  // Resolved kind labels for SelectValue (base-ui prints the raw value
  // otherwise) and the option list.
  const kindLabels = useMemo<Record<RuleKind, string>>(
    () =>
      Object.fromEntries(
        (Object.keys(KIND_LABEL_KEY) as RuleKind[]).map((k) => [
          k,
          t(KIND_LABEL_KEY[k]),
        ]),
      ) as Record<RuleKind, string>,
    [t],
  );
  const [draft, setDraft] = useState<RuleDraft>(() => ({
    name: rule?.name ?? "",
    is_active: rule?.is_active ?? true,
    priority: rule?.priority ?? 100,
    kind: rule?.kind ?? "round_robin",
    channel: rule?.channel ?? "",
    config: rule?.config ?? {},
  }));
  const [saving, setSaving] = useState(false);

  // Texto editable de agent_ids — separado por comas, parseado al guardar.
  const agentIdsInitial = useMemo(() => {
    const cfg = (rule?.config ?? {}) as { agent_ids?: string[] };
    return (cfg.agent_ids ?? []).join(", ");
  }, [rule]);
  const [agentIdsText, setAgentIdsText] = useState(agentIdsInitial);

  async function submit() {
    if (!draft.name.trim()) {
      toast.error(t("settings.giveItAName"));
      return;
    }
    if (!workspaceId) {
      toast.error(t("settings.workspaceUnavailable"));
      return;
    }
    // Recompone config según kind.
    let config: Record<string, unknown> = {};
    if (draft.kind === "round_robin") {
      const ids = agentIdsText
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      config = { agent_ids: ids };
    } else if (draft.kind === "by_tag") {
      config = {
        tag_id: draft.config.tag_id ?? "",
        agent_id: draft.config.agent_id ?? "",
      };
    } else if (draft.kind === "by_channel") {
      config = {
        channel: draft.config.channel ?? "",
        agent_id: draft.config.agent_id ?? "",
      };
    } else if (draft.kind === "by_keyword") {
      config = {
        keyword: draft.config.keyword ?? "",
        agent_id: draft.config.agent_id ?? "",
      };
    }
    setSaving(true);
    const res = await fetchWithCsrf("/api/inbox/assignment-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: rule?.id,
        workspace_id: workspaceId,
        name: draft.name.trim(),
        is_active: draft.is_active,
        priority: draft.priority,
        kind: draft.kind,
        channel: draft.channel || null,
        config,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? t("settings.couldNotSave"));
      return;
    }
    toast.success(rule ? t("settings.ruleUpdated") : t("settings.ruleCreated"));
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
            {rule ? t("settings.editRule") : t("settings.newRule")}
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
            <Label htmlFor="rule-name" className="text-xs text-foreground">
              {t("settings.ruleNameLabel")}
            </Label>
            <Input
              id="rule-name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder={t("settings.ruleNamePlaceholder")}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-foreground">{t("settings.ruleTypeLabel")}</Label>
              <Select
                value={draft.kind}
                onValueChange={(v) => {
                  if (typeof v !== "string") return;
                  setDraft((d) => ({ ...d, kind: v as RuleKind, config: {} }));
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue labels={kindLabels} />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL_KEY) as RuleKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabels[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t(KIND_HINT_KEY[draft.kind])}
              </p>
            </div>

            <div>
              <Label className="text-xs text-foreground">{t("settings.ruleChannelLabel")}</Label>
              <Select
                value={draft.channel || "any"}
                onValueChange={(v) => {
                  const next = typeof v === "string" && v !== "any" ? v : "";
                  setDraft((d) => ({ ...d, channel: next }));
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue labels={channelSelectLabels} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t("settings.anyOption")}</SelectItem>
                  {CHANNELS.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {channelLabel(ch, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {t("settings.ruleChannelHint")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-foreground">{t("settings.rulePriorityLabel")}</Label>
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
              <span className="text-xs text-foreground">{t("settings.ruleActiveLabel")}</span>
              <Switch
                checked={draft.is_active}
                onCheckedChange={(v) =>
                  setDraft((d) => ({ ...d, is_active: !!v }))
                }
              />
            </div>
          </div>

          {/* Detalles específicos por kind. */}
          {draft.kind === "round_robin" && (
            <div>
              <Label className="text-xs text-foreground">
                {t("settings.agentIdsLabel")}
              </Label>
              <Input
                value={agentIdsText}
                onChange={(e) => setAgentIdsText(e.target.value)}
                placeholder="uuid-1, uuid-2"
                className={cn("mt-1 font-mono text-xs")}
              />
            </div>
          )}

          {draft.kind === "by_tag" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-foreground">{t("settings.tagIdLabel")}</Label>
                <Input
                  value={String(draft.config.tag_id ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      config: { ...d.config, tag_id: e.target.value },
                    }))
                  }
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-foreground">{t("settings.agentIdLabel")}</Label>
                <Input
                  value={String(draft.config.agent_id ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      config: { ...d.config, agent_id: e.target.value },
                    }))
                  }
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>
          )}

          {draft.kind === "by_keyword" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-foreground">{t("settings.keywordLabel")}</Label>
                <Input
                  value={String(draft.config.keyword ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      config: { ...d.config, keyword: e.target.value },
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-foreground">{t("settings.agentIdLabel")}</Label>
                <Input
                  value={String(draft.config.agent_id ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      config: { ...d.config, agent_id: e.target.value },
                    }))
                  }
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>
          )}

          {draft.kind === "by_channel" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-foreground">{t("settings.targetChannelLabel")}</Label>
                <Select
                  value={String(draft.config.channel ?? "")}
                  onValueChange={(v) => {
                    if (typeof v !== "string") return;
                    setDraft((d) => ({
                      ...d,
                      config: { ...d.config, channel: v },
                    }));
                  }}
                >
                  <SelectTrigger className="mt-1 w-full">
                    <SelectValue labels={channelSelectLabels} placeholder={t("settings.selectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {channelLabel(ch, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-foreground">{t("settings.agentIdLabel")}</Label>
                <Input
                  value={String(draft.config.agent_id ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      config: { ...d.config, agent_id: e.target.value },
                    }))
                  }
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>
          )}
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
