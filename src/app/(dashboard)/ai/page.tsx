'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Sparkles,
  Pencil,
  Trash2,
  Power,
  Send,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AgentEditor } from '@/components/ai/agent-editor';
import type { AiAgent } from '@/lib/ai/types';
import type { Channel } from '@/types';

export type AgentSummary = Omit<AiAgent, 'api_key_encrypted'> & {
  has_api_key: boolean;
  ai_agent_channels?: { channel: Channel }[];
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
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentSummary | 'new' | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/agents?workspace_id=${workspace.id}`);
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
    const res = await fetch(`/api/ai/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !agent.is_active }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? 'No se pudo actualizar');
      return;
    }
    toast.success(agent.is_active ? 'Desactivado' : 'Activado');
    void load();
  }

  async function handleDelete(agent: AgentSummary) {
    if (!confirm(`¿Eliminar "${agent.name}"?`)) return;
    const res = await fetch(`/api/ai/agents/${agent.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('No se pudo eliminar');
      return;
    }
    toast.success('Eliminado');
    void load();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Servicio al cliente con IA
            </h1>
            <p className="text-xs text-muted-foreground">
              Asistentes que responden 24/7 con todo el contexto de la conversación.
            </p>
          </div>
        </div>
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
          onSaved={async () => {
            setEditing(null);
            await load();
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
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-colors',
        agent.is_active
          ? 'border-emerald-500/40'
          : 'border-border hover:border-foreground/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            agent.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-muted text-muted-foreground',
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
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            agent.is_active
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {agent.is_active ? 'Activo' : 'Pausado'}
        </span>
      </div>

      {agent.persona && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {agent.persona}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span>
          {agent.tone} · {agent.model.replace(/^claude-/, '')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            title={agent.is_active ? 'Pausar' : 'Activar'}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Power className="size-4" />
          </button>
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
        Configurá un agente que responde en WhatsApp, Instagram, Messenger,
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
