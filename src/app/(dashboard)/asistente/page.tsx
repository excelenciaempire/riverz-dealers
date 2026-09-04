'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  BarChart3,
  Loader2,
  Plus,
  Sparkles,
  Pencil,
  Trash2,
  Send,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
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
import { limpiarPersona } from '@/lib/ai/persona-limpia';
import { AnswerGapsPanel } from '@/components/ai/answer-gaps-panel';
import { EscalacionesPanel } from '@/components/ai/escalaciones-panel';
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
  zoho: 'Zoho Mail',
  fb_comment: 'assistant.channelFbComments',
  ig_comment: 'assistant.channelIgComments',
  mercadolibre: 'Mercado Libre',
  tiktok_comment: 'assistant.channelTiktokComments',
  voice: 'Voz',
  webchat: 'assistant.channelWebchat',
};

/**
 * ¿Hay otro asistente que se queda con todos sus mensajes?
 *
 * `pickAgent` no reparte: entre los que pueden atender un canal elige por
 * prioridad y, como la prioridad no se edita desde ningún lado y todos valen
 * cero, el desempate real es la ANTIGÜEDAD. Así que dos asistentes con el
 * mismo alcance, todo el catálogo y el mismo rol no se turnan: contesta el más
 * viejo siempre y el otro no contesta nunca, los dos mostrando "en línea".
 *
 * Se avisa sólo en ese caso exacto. Un asistente de un canal concreto o de
 * unos productos concretos SÍ puede ganar por su lado, y marcarlo como tapado
 * sería mentir.
 */
function tapadoPor(todos: AgentSummary[], agent: AgentSummary): string | null {
  if (!agent.is_active || agent.product_scope !== 'all') return null;
  const mismoAlcance = (a: AgentSummary) =>
    a.scope === agent.scope &&
    a.product_scope === 'all' &&
    (a.role ?? 'general') === (agent.role ?? 'general');
  const gana = todos
    .filter((a) => a.is_active && mismoAlcance(a))
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    )[0];
  return gana && gana.id !== agent.id ? gana.name : null;
}

export default function AiAgentsPage() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentSummary | 'new' | null>(null);

  // Entrada por enlace a un asistente concreto desde acciones contextuales.
  const params = useSearchParams();
  const agenteEnLaUrl = params.get('agent');
  const solapaEnLaUrl = params.get('tab');
  // La solapa con la que se abre el editor cuando se pide desde una tarjeta.
  // Va por estado y no por la URL porque es un gesto de esta pantalla, no una
  // dirección que alguien vaya a compartir.
  const [solapaPedida, setSolapaPedida] = useState<'stats' | undefined>(
    undefined
  );
  // Una sola vez: si no, cerrar el editor con el parámetro todavía en la URL
  // lo volvía a abrir en el acto y no había forma de salir.
  const yaAbierto = useRef(false);

  const load = useCallback(async () => {
    // Sin cuenta resuelta no hay a quién preguntarle, y `loading` arranca en
    // true: cortar acá sin bajarlo dejaba la pantalla girando para siempre, que
    // se lee como "está cargando" cuando en realidad no va a pasar nada.
    if (!workspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/agents?workspace_id=${workspace.id}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (res.ok) setAgents((json.agents ?? []) as AgentSummary[]);
      else toast.error(json.error ?? t('assistant.loadError'));
    } catch (err) {
      toast.error(t('assistant.genericError'));
    } finally {
      setLoading(false);
    }
  }, [workspace, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (yaAbierto.current || loading || !agenteEnLaUrl) return;
    if (agenteEnLaUrl === 'nuevo') {
      yaAbierto.current = true;
      setEditing('new');
      return;
    }
    const encontrado = agents.find((a) => a.id === agenteEnLaUrl);
    // Sin coincidencia no se hace nada: un id viejo o de otra cuenta deja la
    // lista como está, que es más honesto que abrir el editor de otro agente.
    if (encontrado) {
      yaAbierto.current = true;
      setEditing(encontrado);
    }
  }, [agenteEnLaUrl, agents, loading]);

  async function toggleActive(agent: AgentSummary) {
    // Optimistic — flip the UI immediately so the active/paused chip
    // changes the moment the user clicks; revert on failure.
    const next = !agent.is_active;
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, is_active: next } : a))
    );
    const res = await fetchWithCsrf(`/api/ai/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? t('assistant.updateError'));
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, is_active: !next } : a))
      );
    }
  }

  async function handleDelete(agent: AgentSummary) {
    if (!confirm(t('assistant.deleteConfirm', { name: agent.name }))) return;
    const prev = agents;
    setAgents((p) => p.filter((a) => a.id !== agent.id));
    const res = await fetchWithCsrf(`/api/ai/agents/${agent.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(t('assistant.deleteError'));
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
        <h1 className="text-foreground text-xl font-semibold">
          {t('assistant.pageTitle')}
        </h1>
        {/* El botón solo cuando ya hay asistentes: en vacío manda el CTA del
            empty state, sin duplicar la acción. */}
        {agents.length > 0 && (
          <Button
            onClick={() => setEditing('new')}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t('assistant.newAgent')}
          </Button>
        )}
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : agents.length === 0 ? (
        <EmptyState onCreate={() => setEditing('new')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              tapadoPor={tapadoPor(agents, agent)}
              onEdit={() => setEditing(agent)}
              onStats={() => {
                setSolapaPedida('stats');
                setEditing(agent);
              }}
              onToggle={() => toggleActive(agent)}
              onDelete={() => handleDelete(agent)}
            />
          ))}
        </div>
      )}

      {/* Los casos que dejó en manos de una persona. Van antes que los huecos
          porque tienen a alguien esperando del otro lado: un hueco se puede
          cerrar mañana, un caso escalado no. */}
      {!loading && agents.length > 0 ? (
        <section className="border-border bg-card rounded-2xl border p-4">
          <h2 className="text-foreground text-sm font-semibold">
            {t('assistant.escalacionesTitle')}
          </h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
            {t('assistant.escalacionesHint')}
          </p>
          <EscalacionesPanel />
        </section>
      ) : null}

      {/* Lo que no supo contestar. Va acá y no en una pantalla aparte porque es
          conocimiento del agente: se mira en el mismo lugar donde se lo edita,
          que es donde uno va a cargar la respuesta que falta. */}
      {!loading && agents.length > 0 ? (
        <section className="border-border bg-card rounded-2xl border p-4">
          <h2 className="text-foreground text-sm font-semibold">
            {t('gaps.title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
            {t('gaps.hint')}
          </p>
          <AnswerGapsPanel />
        </section>
      ) : null}

      {editing && workspace && (
        <AgentEditor
          workspaceId={workspace.id}
          agent={editing === 'new' ? null : editing}
          initialTab={
            solapaPedida ??
            (solapaEnLaUrl === 'tools' ||
            solapaEnLaUrl === 'reach' ||
            solapaEnLaUrl === 'advanced' ||
            solapaEnLaUrl === 'stats'
              ? solapaEnLaUrl
              : undefined)
          }
          onClose={() => {
            setSolapaPedida(undefined);
            setEditing(null);
          }}
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
  onStats,
  tapadoPor,
  onToggle,
  onDelete,
}: {
  agent: AgentSummary;
  onEdit: () => void;
  onStats: () => void;
  /** Si otro asistente se queda con todos sus mensajes, cuál. */
  tapadoPor: string | null;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const channels = useMemo(
    () => (agent.ai_agent_channels ?? []).map((c) => c.channel as Channel),
    [agent.ai_agent_channels]
  );
  const active = agent.is_active;
  return (
    <div
      className={cn(
        'bg-card relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-4 transition-all',
        active
          ? 'border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_8px_24px_-12px_rgba(16,185,129,0.4)]'
          : 'border-border opacity-70 hover:opacity-100'
      )}
    >
      {/* Top bleed: emerald glow when active, muted bar when paused */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[2px]',
          active
            ? 'bg-emerald-500 dark:bg-emerald-400'
            : 'bg-muted-foreground/20'
        )}
      />

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            active
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-semibold">
            {agent.name}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {agent.scope === 'workspace'
              ? t('assistant.allChannels')
              : channels.length === 0
                ? t('assistant.noChannelsAssigned')
                : channels
                    .map((c) => {
                      const label = CHANNEL_LABEL[c];
                      // Los canales con marca propia (WhatsApp, Instagram…) se
                      // muestran tal cual; los de comentarios son claves i18n.
                      return label.startsWith('assistant.') ? t(label) : label;
                    })
                    .join(' · ')}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
            active
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              active
                ? 'animate-pulse bg-emerald-500 dark:bg-emerald-400'
                : 'bg-muted-foreground/60'
            )}
          />
          {active ? t('assistant.statusOnline') : t('assistant.statusPaused')}
        </span>
      </div>

      {agent.persona && (
        <p
          className={cn(
            'line-clamp-2 text-xs leading-relaxed',
            active ? 'text-muted-foreground' : 'text-muted-foreground/70'
          )}
        >
          {limpiarPersona(agent.persona)}
        </p>
      )}

      <div className="border-border text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
        <button
          type="button"
          onClick={onStats}
          className="border-border text-muted-foreground hover:border-accent-ink/40 hover:bg-accent/40 hover:text-foreground inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
        >
          <BarChart3 className="size-3.5" />
          {t('assistant.tabStats')}
        </button>
        <div className="flex items-center gap-2">
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Switch
                    checked={active}
                    onCheckedChange={onToggle}
                    aria-label={
                      active
                        ? t('assistant.deactivate')
                        : t('assistant.activate')
                    }
                  />
                }
              />
              <TooltipContent>
                {active ? t('assistant.activated') : t('assistant.deactivated')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            onClick={onEdit}
            title={t('assistant.edit')}
            className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex min-h-9 min-w-9 items-center justify-center rounded p-1"
          >
            <Pencil className="size-4" />
          </button>
          <button
            onClick={onDelete}
            title={t('assistant.delete')}
            className="text-muted-foreground hover:bg-accent inline-flex min-h-9 min-w-9 items-center justify-center rounded p-1 hover:text-red-700 dark:hover:text-red-400"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useT();
  return (
    <div className="border-border bg-card/40 rounded-2xl border border-dashed p-10 text-center">
      <div className="bg-primary/10 text-accent-ink mx-auto flex size-14 items-center justify-center rounded-2xl">
        <Sparkles className="size-7" />
      </div>
      <p className="text-foreground mt-4 text-base font-semibold">
        {t('assistant.emptyTitle')}
      </p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        {t('assistant.emptyDescription')}
      </p>
      <Button
        onClick={onCreate}
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-5"
      >
        <Plus className="size-4" />
        {t('assistant.createAgent')}
      </Button>
    </div>
  );
}

// Lint silencer — Send used inside editor component
void Send;
