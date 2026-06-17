'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Sparkles,
  Pencil,
  Trash2,
  Send,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { AgentEditor } from '@/components/ai/agent-editor';
import { SupportModeSwitcher } from '@/components/support/mode-switcher';
import type { AiAgent } from '@/lib/ai/types';
import type { Channel } from '@/types';

export type AgentSummary = Omit<AiAgent, 'api_key_encrypted'> & {
  has_api_key: boolean;
  ai_agent_channels?: { channel: Channel }[];
  ai_agent_products?: { product_id: string }[];
};

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  gmail: 'Gmail',
  outlook: 'Outlook',
  fb_comment: 'Comentarios FB',
  ig_comment: 'Comentarios IG',
};

export default function AiAgentsPage() {
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentSummary | 'new' | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/agents?workspace_id=${workspace.id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok) setAgents((json.agents ?? []) as AgentSummary[]);
      else toast.error(json.error ?? 'No se cargaron los agentes');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(agent: AgentSummary) {
    // Optimistic — flip the UI immediately so the active/paused chip
    // changes the moment the user clicks; revert on failure.
    const next = !agent.is_active;
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, is_active: next } : a)),
    );
    const res = await fetchWithCsrf(`/api/ai/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? 'No se pudo actualizar');
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, is_active: !next } : a)),
      );
    }
  }

  async function handleDelete(agent: AgentSummary) {
    if (!confirm(`¿Eliminar "${agent.name}"?`)) return;
    const prev = agents;
    setAgents((p) => p.filter((a) => a.id !== agent.id));
    const res = await fetchWithCsrf(`/api/ai/agents/${agent.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('No se pudo eliminar');
      setAgents(prev);
    }
  }

  function applySavedAgent(saved: AgentSummary) {
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === saved.id);
      if (exists) return prev.map((a) => (a.id === saved.id ? saved : a));
      return [saved, ...prev];
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SupportModeSwitcher current="ai" />

      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Asistentes con IA</h1>
        <Button
          onClick={() => setEditing('new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Nuevo asistente
        </Button>
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <EmptyState onCreate={() => setEditing('new')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={() => setEditing(agent)}
              onToggle={() => toggleActive(agent)}
              onDelete={() => handleDelete(agent)}
            />
          ))}
        </div>
      )}

      {editing && workspace && (
        <AgentEditor
          workspaceId={workspace.id}
          agent={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            applySavedAgent(saved);
            setEditing(null);
          }}
          onAgentUpserted={(saved) => {
            // Refresca la lista sin cerrar el editor — lo usa la
            // generación con IA y la resincronización de conocimiento.
            applySavedAgent(saved);
          }}
        />
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onEdit,
  onToggle,
  onDelete,
}: {
  agent: AgentSummary;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const channels = useMemo(
    () => (agent.ai_agent_channels ?? []).map((c) => c.channel as Channel),
    [agent.ai_agent_channels],
  );
  const active = agent.is_active;
  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 transition-all',
        active
          ? 'border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_8px_24px_-12px_rgba(16,185,129,0.4)]'
          : 'border-border opacity-70 hover:opacity-100',
      )}
    >
      {/* Top bleed: emerald glow when active, muted bar when paused */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px]',
          active ? 'bg-emerald-400' : 'bg-muted-foreground/20',
        )}
      />

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            active
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent.scope === 'workspace'
              ? 'Todos los canales'
              : channels.length === 0
                ? 'Sin canales asignados'
                : channels.map((c) => CHANNEL_LABEL[c]).join(' · ')}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            active
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              active ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground/60',
            )}
          />
          {active ? 'En línea' : 'Pausado'}
        </span>
      </div>

      {agent.persona && (
        <p
          className={cn(
            'line-clamp-2 text-xs leading-relaxed',
            active ? 'text-muted-foreground' : 'text-muted-foreground/70',
          )}
        >
          {agent.persona}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="capitalize">{agent.tone}</span>
        <div className="flex items-center gap-2">
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Switch
                    checked={active}
                    onCheckedChange={onToggle}
                    aria-label={active ? 'Desactivar' : 'Activar'}
                  />
                }
              />
              <TooltipContent>{active ? 'Activado' : 'Desactivado'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            onClick={onEdit}
            title="Editar"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-4" />
          </button>
          <button
            onClick={onDelete}
            title="Eliminar"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-7" />
      </div>
      <p className="mt-4 text-base font-semibold text-foreground">
        Tu asistente 24/7
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Configura un agente que responde en WhatsApp, Instagram, Messenger,
        Gmail u Outlook con el contexto completo de cada conversación.
      </p>
      <Button
        onClick={onCreate}
        className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-4" />
        Crear asistente
      </Button>
    </div>
  );
}

// Lint silencer — Send used inside editor component
void Send;
