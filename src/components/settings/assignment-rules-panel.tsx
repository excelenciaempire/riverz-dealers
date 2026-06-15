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
import { channelDisplay } from "@/lib/channels/display";
import { cn } from "@/lib/utils";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";

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

const KIND_LABEL: Record<RuleKind, string> = {
  round_robin: "Round robin",
  by_tag: "Por etiqueta",
  by_channel: "Por canal",
  by_keyword: "Por palabra clave",
};

const KIND_HINT: Record<RuleKind, string> = {
  round_robin: "Rota la conversación entre los agentes seleccionados.",
  by_tag: "Asigna al agente si el contacto tiene la etiqueta.",
  by_channel: "Asigna al agente cuando la conversación viene del canal.",
  by_keyword: "Asigna al agente si el primer mensaje contiene la palabra.",
};

// Mapa para SelectValue: el componente base-ui imprime el value crudo si
// no le damos children o labels. Cubrimos el sentinel "any" + cada canal.
const channelSelectLabels: Record<string, string> = {
  any: "Cualquiera",
  ...Object.fromEntries(
    CHANNELS.map((c) => [c, channelDisplay(c)?.label ?? c]),
  ),
};

export function AssignmentRulesPanel() {
  const fetchWithCsrf = useFetchWithCsrf();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/inbox/assignment-rules");
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "No se cargaron las reglas");
      setRules([]);
      return;
    }
    setRules((json.rules ?? []) as RuleRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(rule: RuleRow, next: boolean) {
    setRules((prev) =>
      prev?.map((r) => (r.id === rule.id ? { ...r, is_active: next } : r)) ??
      prev,
    );
    const res = await fetchWithCsrf("/api/inbox/assignment-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: rule.id,
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
      toast.error(json.error ?? "No se pudo actualizar");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar regla?")) return;
    setDeletingId(id);
    const res = await fetchWithCsrf(`/api/inbox/assignment-rules?id=${id}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "No se pudo eliminar");
      return;
    }
    setRules((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    toast.success("Regla eliminada");
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
            Reglas de asignación
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando entra una conversación nueva sin asignar, se evalúan estas
            reglas en orden de prioridad. La primera que coincide gana.
          </p>
        </div>
        <Button
          onClick={() => setEditing("new")}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Nueva regla
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-accent-ink">
            <GitBranch className="size-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Sin reglas todavía
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Crea una para que tu bandeja reparta las conversaciones entre el
            equipo automáticamente.
          </p>
          <Button
            onClick={() => setEditing("new")}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            Crear primera regla
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
  const channelLabel = rule.channel
    ? channelDisplay(rule.channel as Channel)?.label ?? rule.channel
    : "Cualquier canal";
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
            {KIND_LABEL[rule.kind]}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          Prioridad {rule.priority} · {channelLabel}
        </p>
      </button>
      <Switch
        checked={rule.is_active}
        onCheckedChange={(v) => onToggle(!!v)}
        aria-label={rule.is_active ? "Pausar regla" : "Activar regla"}
      />
      <button
        onClick={onEdit}
        title="Editar"
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Pencil className="size-4" />
      </button>
      <button
        onClick={onDelete}
        disabled={deleting}
        title="Eliminar"
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-red-400 disabled:opacity-50"
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
  onClose,
  onSaved,
}: {
  rule: RuleRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const fetchWithCsrf = useFetchWithCsrf();
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
      toast.error("Ponle un nombre");
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
      toast.error(json.error ?? "No se pudo guardar");
      return;
    }
    toast.success(rule ? "Regla actualizada" : "Regla creada");
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
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            {rule ? "Editar regla" : "Nueva regla"}
          </h3>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="rule-name" className="text-xs text-foreground">
              Nombre
            </Label>
            <Input
              id="rule-name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder="Ej: Repartir a soporte"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground">Tipo</Label>
              <Select
                value={draft.kind}
                onValueChange={(v) => {
                  if (typeof v !== "string") return;
                  setDraft((d) => ({ ...d, kind: v as RuleKind, config: {} }));
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue labels={KIND_LABEL} />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as RuleKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {KIND_HINT[draft.kind]}
              </p>
            </div>

            <div>
              <Label className="text-xs text-foreground">Canal</Label>
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
                  <SelectItem value="any">Cualquiera</SelectItem>
                  {CHANNELS.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {channelDisplay(ch)?.label ?? ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                La regla solo aplica a conversaciones de este canal.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground">Prioridad</Label>
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
              <span className="text-xs text-foreground">Activa</span>
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
                IDs de agentes (separados por coma)
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-foreground">ID de etiqueta</Label>
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
                <Label className="text-xs text-foreground">ID de agente</Label>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-foreground">Palabra clave</Label>
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
                <Label className="text-xs text-foreground">ID de agente</Label>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-foreground">Canal objetivo</Label>
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
                    <SelectValue labels={channelSelectLabels} placeholder="Selecciona" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {channelDisplay(ch)?.label ?? ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-foreground">ID de agente</Label>
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
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
