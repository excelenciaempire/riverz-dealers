'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Send,
  Sparkles,
  X,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AiAgent, AiScope, AiTone } from '@/lib/ai/types';
import type { AgentSummary } from '@/app/(dashboard)/ai/page';
import type { Channel } from '@/types';

const TONES: { value: AiTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Cercano', hint: 'Cálido, conversacional, frases cortas.' },
  { value: 'formal', label: 'Formal', hint: 'Profesional, distancia respetuosa.' },
  { value: 'casual', label: 'Coloquial', hint: 'Directo, modismos suaves.' },
  { value: 'concise', label: 'Breve', hint: 'Una o dos frases, sin rodeos.' },
];

const TONE_LABELS = Object.fromEntries(TONES.map((t) => [t.value, t.label]));

const MODELS = [
  {
    value: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 · rápido y barato',
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6 · equilibrio calidad / costo',
  },
  {
    value: 'claude-opus-4-8',
    label: 'Claude Opus 4.8 · máxima calidad',
  },
];

const MODEL_LABELS = Object.fromEntries(MODELS.map((m) => [m.value, m.label]));

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
];

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'Inglés' },
  { code: 'pt', label: 'Portugués' },
  { code: 'fr', label: 'Francés' },
];

const LANGUAGE_LABELS = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));

interface AgentEditorProps {
  workspaceId: string;
  agent: AgentSummary | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function AgentEditor({ workspaceId, agent, onClose, onSaved }: AgentEditorProps) {
  const editing = Boolean(agent?.id);

  const [name, setName] = useState(agent?.name ?? '');
  const [isActive, setIsActive] = useState(agent?.is_active ?? false);
  const [persona, setPersona] = useState(
    agent?.persona ??
      'Sos un asistente de atención al cliente. Respondés con calidez y vas directo al grano.',
  );
  const [knowledge, setKnowledge] = useState(agent?.knowledge ?? '');
  const [language, setLanguage] = useState(agent?.language ?? 'es');
  const [tone, setTone] = useState<AiTone>(agent?.tone ?? 'friendly');
  const [maxChars, setMaxChars] = useState(agent?.max_response_chars ?? 500);
  const [delaySec, setDelaySec] = useState(agent?.reply_delay_seconds ?? 0);
  const [contextMessages, setContextMessages] = useState(agent?.context_messages ?? 10);
  const [replyWhenAssigned, setReplyWhenAssigned] = useState(
    agent?.reply_when_assigned ?? false,
  );
  const [replyOutsideHours, setReplyOutsideHours] = useState(
    agent?.reply_outside_hours ?? true,
  );
  const [escalateKeywords, setEscalateKeywords] = useState<string[]>(
    agent?.escalate_keywords ?? ['humano', 'agente', 'reembolso'],
  );
  const [escalateInput, setEscalateInput] = useState('');
  const [model, setModel] = useState(agent?.model ?? 'claude-haiku-4-5-20251001');
  const [scope, setScope] = useState<AiScope>(agent?.scope ?? 'workspace');
  const [channels, setChannels] = useState<Channel[]>(
    (agent?.ai_agent_channels ?? []).map((c) => c.channel as Channel),
  );
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  function toggleEscalate(kw: string) {
    setEscalateKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function addEscalate() {
    const v = escalateInput.trim().toLowerCase();
    if (!v) return;
    if (escalateKeywords.includes(v)) return;
    setEscalateKeywords((prev) => [...prev, v]);
    setEscalateInput('');
  }

  function toggleChannel(c: Channel) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Falta el nombre');
      return;
    }
    setSaving(true);
    const payload: Partial<AiAgent> & {
      workspace_id?: string;
      channels?: string[];
      api_key?: string;
    } = {
      workspace_id: workspaceId,
      name: name.trim(),
      is_active: isActive,
      persona: persona.trim(),
      knowledge: knowledge.trim() || null,
      language,
      tone,
      max_response_chars: maxChars,
      reply_delay_seconds: delaySec,
      context_messages: contextMessages,
      reply_when_assigned: replyWhenAssigned,
      reply_outside_hours: replyOutsideHours,
      escalate_keywords: escalateKeywords,
      model,
      scope,
      channels: scope === 'channels' ? channels : [],
    };
    if (apiKey.trim()) payload.api_key = apiKey.trim();

    const url = editing ? `/api/ai/agents/${agent!.id}` : '/api/ai/agents';
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? 'No se pudo guardar');
      return;
    }
    toast.success(editing ? 'Guardado' : 'Asistente creado');
    await onSaved();
  }

  async function runTest() {
    if (!testMessage.trim()) return;
    if (!editing) {
      toast.error('Guardá primero para probar.');
      return;
    }
    setTesting(true);
    setTestReply(null);
    try {
      const res = await fetch(`/api/ai/agents/${agent!.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testMessage }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falló');
      setTestReply(json.reply ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-card p-0 text-foreground sm:max-w-3xl lg:max-w-5xl"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {editing ? agent!.name || 'Asistente' : 'Nuevo asistente'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Responde automáticamente con el contexto completo de cada chat.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              {isActive ? 'Activo' : 'Pausado'}
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 gap-0 overflow-hidden sm:grid-cols-[minmax(0,1fr)_360px]">
          {/* Form column */}
          <div className="space-y-6 overflow-y-auto p-6">
            <Section title="Identidad">
              <Field label="Nombre">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Asistente principal"
                  className="bg-background"
                />
              </Field>
              <Field label="Personalidad">
                <Textarea
                  value={persona}
                  rows={4}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Sos María, asesora de Vitalú. Ayudás a clientes a elegir productos de skincare. Mantenés un tono cálido."
                  className="resize-y bg-background"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Idioma">
                  <Select value={language} onValueChange={(v) => setLanguage(v ?? 'es')}>
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue labels={LANGUAGE_LABELS} />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Modelo">
                  <Select value={model} onValueChange={(v) => setModel(v ?? '')}>
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue labels={MODEL_LABELS} />
                    </SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </Section>

            <Section title="Tono">
              <div className="grid gap-2 sm:grid-cols-4">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTone(t.value)}
                    title={t.hint}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      tone === t.value
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Conocimiento del negocio">
              <Textarea
                value={knowledge}
                onChange={(e) => setKnowledge(e.target.value)}
                rows={6}
                placeholder={'Productos:\n- Crema antiarrugas $50.000\n- Sérum vitamina C $80.000\n\nPolíticas:\n- Envíos en 2 días hábiles\n- Devolución en 15 días'}
                className="resize-y bg-background font-mono text-xs leading-relaxed"
              />
            </Section>

            <Section title="¿En qué canales responde?">
              <div className="grid grid-cols-2 gap-2">
                <ScopeCard
                  active={scope === 'workspace'}
                  onClick={() => setScope('workspace')}
                  title="Todos los canales"
                  hint="Aplica al workspace entero."
                />
                <ScopeCard
                  active={scope === 'channels'}
                  onClick={() => setScope('channels')}
                  title="Solo algunos"
                  hint="Elegí los canales abajo."
                />
              </div>
              {scope === 'channels' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CHANNELS.map((c) => {
                    const on = channels.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleChannel(c.value)}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                          on
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                        )}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Reglas">
              <ToggleRow
                checked={replyWhenAssigned}
                onChange={setReplyWhenAssigned}
                title="Responder aunque haya agente asignado"
                hint="Por defecto, si un humano está atendiendo, la IA calla."
              />
              <ToggleRow
                checked={replyOutsideHours}
                onChange={setReplyOutsideHours}
                title="Responder fuera del horario"
                hint="Apagá para que la IA solo conteste dentro del horario de oficina."
              />
              <div className="space-y-2">
                <Label className="text-foreground">Palabras de escalamiento</Label>
                <p className="text-[11px] text-muted-foreground">
                  Si el mensaje del cliente contiene cualquiera de estas, la IA
                  no responde y queda esperando un humano.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {escalateKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs text-primary"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => toggleEscalate(kw)}
                        className="rounded hover:text-red-400"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={escalateInput}
                    onChange={(e) => setEscalateInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addEscalate();
                      }
                    }}
                    onBlur={addEscalate}
                    placeholder="Añadí palabra…"
                    className="min-w-[120px] flex-1 rounded-md border border-dashed border-border bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </Section>

            <Section title="Comportamiento avanzado">
              <SliderField
                label="Largo máximo de respuesta"
                value={maxChars}
                min={120}
                max={2000}
                step={20}
                suffix="caracteres"
                onChange={setMaxChars}
              />
              <SliderField
                label="Esperar antes de responder"
                value={delaySec}
                min={0}
                max={120}
                step={5}
                suffix="segundos"
                hint="Suaviza la respuesta para que no parezca un bot."
                onChange={setDelaySec}
              />
              <SliderField
                label="Mensajes de contexto"
                value={contextMessages}
                min={1}
                max={30}
                step={1}
                suffix="últimos mensajes"
                onChange={setContextMessages}
              />
            </Section>

            <Section title="API key (opcional)">
              <p className="text-[11px] text-muted-foreground">
                Si querés usar tu propia cuenta de Anthropic en vez de la del
                servidor. La key se guarda cifrada.
              </p>
              <div className="relative">
                <KeyRound className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    agent?.has_api_key
                      ? '••••••••  (ya hay una key guardada)'
                      : 'sk-ant-...'
                  }
                  className="bg-background pl-8 pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </Section>
          </div>

          {/* Test column */}
          <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-muted/30 sm:border-l sm:border-t-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-semibold text-foreground">Probar el asistente</p>
              <p className="text-[11px] text-muted-foreground">
                Mandá un mensaje y mirá cómo respondería.
              </p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {testReply !== null && (
                <div className="rounded-lg border border-border bg-card p-3 text-sm text-foreground">
                  {testReply || <span className="text-muted-foreground italic">Sin respuesta.</span>}
                </div>
              )}
              {testing && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Generando…
                </div>
              )}
              {!editing && (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
                  Guardá el asistente antes de probarlo.
                </p>
              )}
            </div>
            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  rows={2}
                  placeholder="Hola, ¿tienen envío a Bogotá?"
                  className="min-h-[44px] resize-none bg-background text-sm"
                />
                <Button
                  onClick={runTest}
                  disabled={testing || !editing}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </aside>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-card/60 px-6 py-4">
          <p className="text-[11px] text-muted-foreground">
            Tono: <span className="text-foreground">{TONE_LABELS[tone]}</span> ·
            Modelo: <span className="text-foreground">{MODEL_LABELS[model] ?? model}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <div>
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-foreground">{label}</Label>
        <span className="text-xs tabular-nums text-foreground">
          {value} {suffix}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ScopeCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-background hover:border-foreground/30',
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </button>
  );
}
