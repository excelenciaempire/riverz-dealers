'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock,
  CircleSlash,
  Database,
  Layers,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
  Type as TypeIcon,
  Users,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { resolveSegment } from '@/lib/segments/resolve';
import type {
  ContactSegment,
  SegmentMatchMode,
  SegmentRule,
} from '@/lib/segments/types';
import type { Channel, Contact, CustomField, Tag } from '@/types';
import { cn } from '@/lib/utils';

type EditableSegment = {
  id?: string;
  name: string;
  description: string;
  match_mode: SegmentMatchMode;
  rules: SegmentRule[];
};

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  gmail: 'Gmail',
  outlook: 'Outlook',
  fb_comment: 'Comentarios de Facebook',
  ig_comment: 'Comentarios de Instagram',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  email: 'Correo',
  phone: 'Teléfono',
  company: 'Empresa',
};

const FIELD_OPTIONS = [
  { value: 'name', label: 'Nombre' },
  { value: 'email', label: 'Correo' },
  { value: 'phone', label: 'Teléfono' },
  { value: 'company', label: 'Empresa' },
] as const;

const RULE_TYPES: {
  type: SegmentRule['type'];
  label: string;
  description: string;
  Icon: typeof TagIcon;
}[] = [
  { type: 'tag', label: 'Etiqueta', description: 'Tiene o no tiene una etiqueta.', Icon: TagIcon },
  { type: 'channel', label: 'Canal', description: 'El contacto llegó por WhatsApp, Instagram, etc.', Icon: MessageCircle },
  { type: 'created', label: 'Fecha de creación', description: 'Cuándo se creó el contacto.', Icon: CalendarClock },
  { type: 'text', label: 'Texto del contacto', description: 'El nombre, correo, teléfono o empresa contiene algo.', Icon: TypeIcon },
  { type: 'has_field', label: 'Tiene dato', description: 'Si el contacto tiene cargado un campo.', Icon: CircleSlash },
  { type: 'custom_field', label: 'Campo personalizado', description: 'Filtra por un campo que vos creaste.', Icon: Database },
];

// Operator labels used by SelectValue.labels — shown human-readable on the
// trigger but stored as compact codes in the segment rules JSON.
const OP_LABELS = {
  tag: { has: 'tiene', not_has: 'no tiene' },
  channel: { is: 'es', is_not: 'no es' },
  created: {
    last_n_days: 'hace menos de (días)',
    after: 'después de',
    before: 'antes de',
  },
  has_field: { present: 'está cargado', missing: 'está vacío' },
  text: {
    contains: 'contiene',
    equals: 'es exactamente',
    starts_with: 'empieza con',
  },
  custom_field: {
    equals: 'es',
    not_equals: 'no es',
    contains: 'contiene',
  },
} as const;

export function SegmentsPanel() {
  const supabase = useMemo(() => createClient(), []);
  const { workspace } = useWorkspace();
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditableSegment | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    const [{ data: seg }, { data: tg }, { data: cf }] = await Promise.all([
      supabase
        .from('contact_segments')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false }),
      supabase.from('tags').select('*').eq('workspace_id', workspace.id),
      supabase
        .from('custom_fields')
        .select('*')
        .eq('workspace_id', workspace.id),
    ]);
    setSegments((seg ?? []) as ContactSegment[]);
    setTags((tg ?? []) as Tag[]);
    setCustomFields((cf ?? []) as CustomField[]);
    setLoading(false);
  }, [supabase, workspace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  // Auto-open the editor when ?new=1 is in the URL (link from
  // broadcasts → "Crear segmento"). One-shot — strip the flag after.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditing({ name: '', description: '', match_mode: 'all', rules: [] });
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Refresh contact-count chips next to each segment row.
  useEffect(() => {
    if (!workspace || segments.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const s of segments) {
        try {
          const { contacts } = await resolveSegment(
            supabase,
            workspace.id,
            s.rules ?? [],
            s.match_mode,
          );
          next[s.id] = contacts.length;
        } catch {
          next[s.id] = 0;
        }
      }
      if (!cancelled) setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [segments, supabase, workspace]);

  function startNew() {
    setEditing({
      name: '',
      description: '',
      match_mode: 'all',
      rules: [],
    });
  }

  function startEdit(s: ContactSegment) {
    setEditing({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      match_mode: s.match_mode,
      rules: s.rules ?? [],
    });
  }

  async function handleDelete(id: string) {
    if (
      !confirm(
        '¿Eliminar este segmento? Las campañas que lo usen perderán la referencia.',
      )
    )
      return;
    setDeletingId(id);
    const { error } = await supabase.from('contact_segments').delete().eq('id', id);
    setDeletingId(null);
    if (error) {
      toast.error(`No se pudo eliminar: ${error.message}`);
      return;
    }
    toast.success('Segmento eliminado');
    await reload();
  }

  if (!workspace) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Cargando workspace…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Segmentos guardados</h2>
          <p className="text-xs text-muted-foreground">
            Listas dinámicas que podés reutilizar en campañas masivas y automatizaciones.
          </p>
        </div>
        <Button
          onClick={startNew}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Nuevo segmento
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando segmentos…
          </div>
        ) : segments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <Layers className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Todavía no tenés segmentos. Creá uno para reutilizarlo en campañas y
              automatizaciones.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={startNew}
              className="border-border text-foreground hover:bg-accent"
            >
              <Plus className="size-3.5" />
              Crear primer segmento
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {segments.map((s) => {
              const count = counts[s.id];
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40"
                >
                  <button
                    onClick={() => startEdit(s)}
                    className="flex flex-1 items-start gap-3 text-left"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Layers className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {s.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {(s.rules?.length ?? 0)} regla
                        {(s.rules?.length ?? 0) === 1 ? '' : 's'}
                        {' · '}
                        coincide{' '}
                        {s.match_mode === 'all' ? 'con todas' : 'con alguna'}
                        {s.description ? ` · ${s.description}` : ''}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground">
                      <Users className="size-3" />
                      {count == null ? '…' : count}
                    </span>
                    <button
                      onClick={() => startEdit(s)}
                      title="Editar"
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      title="Eliminar"
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-red-400 disabled:opacity-50"
                    >
                      {deletingId === s.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <SegmentEditor
          workspaceId={workspace.id}
          tags={tags}
          customFields={customFields}
          segment={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

interface EditorProps {
  workspaceId: string;
  segment: EditableSegment;
  tags: Tag[];
  customFields: CustomField[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function SegmentEditor({
  workspaceId,
  segment,
  tags,
  customFields,
  onClose,
  onSaved,
}: EditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState(segment.name);
  const [description, setDescription] = useState(segment.description);
  const [matchMode, setMatchMode] = useState<SegmentMatchMode>(segment.match_mode);
  const [rules, setRules] = useState<SegmentRule[]>(segment.rules);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Contact[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [total, setTotal] = useState(0);

  // Debounced live preview so the matching count updates as the user
  // tweaks rules, without hammering Supabase on every keystroke.
  useEffect(() => {
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const { contacts, total } = await resolveSegment(
          supabase,
          workspaceId,
          rules,
          matchMode,
        );
        if (!cancelled) {
          setPreview(contacts);
          setTotal(total);
        }
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rules, matchMode, supabase, workspaceId]);

  function addRule(type: SegmentRule['type']) {
    const stub = stubRuleFor(type, tags, customFields);
    if (!stub) {
      toast.error(
        type === 'tag'
          ? 'Aún no tenés etiquetas para filtrar.'
          : 'Aún no tenés campos personalizados.',
      );
      return;
    }
    setRules((rs) => [...rs, stub]);
  }

  function updateRule(i: number, next: SegmentRule) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? next : r)));
  }

  function removeRule(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Ponle un nombre al segmento.');
      return;
    }
    setSaving(true);
    const payload = {
      workspace_id: workspaceId,
      name: name.trim(),
      description: description.trim() || null,
      match_mode: matchMode,
      rules,
    };
    const { error } = segment.id
      ? await supabase
          .from('contact_segments')
          .update(payload)
          .eq('id', segment.id)
      : await supabase.from('contact_segments').insert(payload);
    setSaving(false);
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`);
      return;
    }
    toast.success(segment.id ? 'Segmento actualizado' : 'Segmento creado');
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-card p-0 text-foreground sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold text-foreground">
            {segment.id ? 'Editar segmento' : 'Nuevo segmento'}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Definí reglas y mirá en vivo cuántos contactos cumplen.
          </p>
        </DialogHeader>

        <div className="grid gap-0 sm:grid-cols-[1fr_320px]">
          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-foreground">Nombre</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VIPs · Última semana · Bogotá"
                  className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground">Descripción (opcional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Clientes que compraron en los últimos 30 días"
                  className="bg-background"
                />
              </div>
            </div>

            {/* Match mode as a segmented control */}
            <div className="space-y-1.5">
              <Label className="text-foreground">Coincidencia</Label>
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                <MatchModeButton
                  active={matchMode === 'all'}
                  onClick={() => setMatchMode('all')}
                  title="Cumple todas"
                  subtitle="Estilo Y: aplica solo si todas las reglas pasan."
                />
                <MatchModeButton
                  active={matchMode === 'any'}
                  onClick={() => setMatchMode('any')}
                  title="Cumple alguna"
                  subtitle="Estilo O: basta con una regla."
                />
              </div>
            </div>

            {/* Rules block */}
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Reglas</p>
                  <p className="text-[11px] text-muted-foreground">
                    {rules.length === 0
                      ? 'Añadí al menos una regla para empezar a filtrar.'
                      : `${rules.length} regla${rules.length === 1 ? '' : 's'} configurada${rules.length === 1 ? '' : 's'}.`}
                  </p>
                </div>
                <AddRuleMenu onAdd={addRule} hasCustomFields={customFields.length > 0} />
              </div>

              {rules.length > 0 && (
                <div className="space-y-2">
                  {rules.map((r, i) => (
                    <RuleRow
                      key={i}
                      rule={r}
                      tags={tags}
                      customFields={customFields}
                      onChange={(next) => updateRule(i, next)}
                      onRemove={() => removeRule(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Preview side panel */}
          <aside className="border-t border-border bg-muted/30 p-4 sm:border-l sm:border-t-0">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Vista previa</span>
              {previewing && <Loader2 className="size-3 animate-spin" />}
            </div>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
              {preview.length}
            </p>
            <p className="text-xs text-muted-foreground">
              de {total} contactos del workspace
            </p>

            <div className="mt-4 max-h-[360px] space-y-1 overflow-y-auto pr-1">
              {preview.slice(0, 50).map((c) => (
                <div
                  key={c.id}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <p className="truncate text-foreground">
                    {c.name ||
                      c.email ||
                      c.phone ||
                      c.external_id ||
                      'Sin nombre'}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {c.email ||
                      c.phone ||
                      CHANNEL_LABELS[c.channel as Channel] ||
                      c.channel}
                  </p>
                </div>
              ))}
              {preview.length > 50 && (
                <p className="px-2 text-[10px] text-muted-foreground">
                  +{preview.length - 50} más…
                </p>
              )}
              {preview.length === 0 && !previewing && (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                  Aún ningún contacto coincide. Probá ajustar las reglas.
                </p>
              )}
            </div>
          </aside>
        </div>

        <DialogFooter className="border-t border-border bg-card/60 px-6 py-4">
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
            Guardar segmento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MatchModeButton({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={subtitle}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {title}
    </button>
  );
}

function AddRuleMenu({
  onAdd,
  hasCustomFields,
}: {
  onAdd: (type: SegmentRule['type']) => void;
  hasCustomFields: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="border-border text-foreground hover:bg-accent"
          />
        }
      >
        <Plus className="size-3.5" />
        Añadir regla
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 border-border bg-card"
      >
        {RULE_TYPES.map((r) => {
          const disabled = r.type === 'custom_field' && !hasCustomFields;
          return (
            <DropdownMenuItem
              key={r.type}
              disabled={disabled}
              onClick={() => onAdd(r.type)}
              className="flex items-start gap-2 py-2 text-foreground focus:bg-accent focus:text-foreground"
            >
              <r.Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.description}
                  {disabled ? ' (no tenés campos personalizados)' : ''}
                </p>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RuleRow({
  rule,
  tags,
  customFields,
  onChange,
  onRemove,
}: {
  rule: SegmentRule;
  tags: Tag[];
  customFields: CustomField[];
  onChange: (next: SegmentRule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <RuleHeader rule={rule} />
        <RuleControls
          rule={rule}
          tags={tags}
          customFields={customFields}
          onChange={onChange}
        />
        <button
          onClick={onRemove}
          title="Quitar regla"
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function RuleHeader({ rule }: { rule: SegmentRule }) {
  const meta = RULE_TYPES.find((r) => r.type === rule.type);
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
      <meta.Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function RuleControls({
  rule,
  tags,
  customFields,
  onChange,
}: {
  rule: SegmentRule;
  tags: Tag[];
  customFields: CustomField[];
  onChange: (next: SegmentRule) => void;
}) {
  switch (rule.type) {
    case 'tag':
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={OP_LABELS.tag}
            options={Object.entries(OP_LABELS.tag).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'has' | 'not_has' })}
          />
          <MiniSelect
            value={rule.tagId}
            labels={Object.fromEntries(tags.map((t) => [t.id, t.name]))}
            options={tags.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => onChange({ ...rule, tagId: v })}
            placeholder="Etiqueta…"
          />
        </>
      );
    case 'channel':
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={OP_LABELS.channel}
            options={Object.entries(OP_LABELS.channel).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'is' | 'is_not' })}
          />
          <MiniSelect
            value={rule.channel}
            labels={CHANNEL_LABELS}
            options={(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => ({
              value: c,
              label: CHANNEL_LABELS[c],
            }))}
            onChange={(v) => onChange({ ...rule, channel: v as Channel })}
          />
        </>
      );
    case 'created':
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={OP_LABELS.created}
            options={Object.entries(OP_LABELS.created).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({
                ...rule,
                op: v as 'last_n_days' | 'before' | 'after',
                value:
                  v === 'last_n_days' ? '30' : new Date().toISOString().slice(0, 10),
              })
            }
          />
          {rule.op === 'last_n_days' ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
                className="h-8 w-20 bg-background text-xs"
              />
              <span className="text-xs text-muted-foreground">días</span>
            </div>
          ) : (
            <Input
              type="date"
              value={rule.value.slice(0, 10)}
              onChange={(e) => onChange({ ...rule, value: e.target.value })}
              className="h-8 w-40 bg-background text-xs"
            />
          )}
        </>
      );
    case 'has_field':
      return (
        <>
          <span className="text-xs text-muted-foreground">El</span>
          <MiniSelect
            value={rule.field}
            labels={FIELD_LABELS}
            options={FIELD_OPTIONS.map((f) => ({
              value: f.value,
              label: f.label.toLowerCase(),
            }))}
            onChange={(v) =>
              onChange({
                ...rule,
                field: v as 'name' | 'email' | 'phone' | 'company',
              })
            }
          />
          <MiniSelect
            value={rule.op}
            labels={OP_LABELS.has_field}
            options={Object.entries(OP_LABELS.has_field).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'present' | 'missing' })}
          />
        </>
      );
    case 'text':
      return (
        <>
          <MiniSelect
            value={rule.field}
            labels={FIELD_LABELS}
            options={FIELD_OPTIONS.map((f) => ({
              value: f.value,
              label: f.label.toLowerCase(),
            }))}
            onChange={(v) =>
              onChange({
                ...rule,
                field: v as 'name' | 'email' | 'phone' | 'company',
              })
            }
          />
          <MiniSelect
            value={rule.op}
            labels={OP_LABELS.text}
            options={Object.entries(OP_LABELS.text).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'contains' | 'equals' | 'starts_with' })
            }
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder="texto"
            className="h-8 w-44 bg-background text-xs"
          />
        </>
      );
    case 'custom_field': {
      const cfLabels = Object.fromEntries(
        customFields.map((f) => [f.id, f.field_name]),
      );
      return (
        <>
          <MiniSelect
            value={rule.fieldId}
            labels={cfLabels}
            options={customFields.map((f) => ({
              value: f.id,
              label: f.field_name,
            }))}
            onChange={(v) => onChange({ ...rule, fieldId: v })}
            placeholder="Campo…"
          />
          <MiniSelect
            value={rule.op}
            labels={OP_LABELS.custom_field}
            options={Object.entries(OP_LABELS.custom_field).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'equals' | 'not_equals' | 'contains' })
            }
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder="valor"
            className="h-8 w-44 bg-background text-xs"
          />
        </>
      );
    }
    default:
      return null;
  }
}

function MiniSelect({
  value,
  options,
  labels,
  onChange,
  placeholder,
}: {
  value: string;
  options: { value: string; label: string }[];
  labels: Record<string, React.ReactNode>;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className="h-8 min-w-[8rem] bg-background text-xs">
        <SelectValue labels={labels} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function stubRuleFor(
  type: SegmentRule['type'],
  tags: Tag[],
  customFields: CustomField[],
): SegmentRule | null {
  switch (type) {
    case 'tag':
      if (tags.length === 0) return null;
      return { type: 'tag', op: 'has', tagId: tags[0].id };
    case 'channel':
      return { type: 'channel', op: 'is', channel: 'whatsapp' };
    case 'created':
      return { type: 'created', op: 'last_n_days', value: '30' };
    case 'has_field':
      return { type: 'has_field', field: 'email', op: 'present' };
    case 'text':
      return { type: 'text', field: 'name', op: 'contains', value: '' };
    case 'custom_field':
      if (customFields.length === 0) return null;
      return {
        type: 'custom_field',
        fieldId: customFields[0].id,
        op: 'equals',
        value: '',
      };
  }
}

void Textarea;
