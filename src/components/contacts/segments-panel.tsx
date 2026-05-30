'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
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

type EditableSegment = {
  id?: string;
  name: string;
  description: string;
  match_mode: SegmentMatchMode;
  rules: SegmentRule[];
};

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram DM',
  messenger: 'Messenger',
  gmail: 'Gmail',
  outlook: 'Outlook',
  fb_comment: 'Comentarios Facebook',
  ig_comment: 'Comentarios Instagram',
};

const FIELDS = [
  { value: 'name', label: 'Nombre' },
  { value: 'email', label: 'Correo' },
  { value: 'phone', label: 'Teléfono' },
  { value: 'company', label: 'Empresa' },
] as const;

/**
 * Right-side panel for the Contactos page → Segmentos tab. Lists saved
 * segments, lets the user create/edit/delete them, and shows a live
 * count + preview of the matching contacts. Resolution runs in the
 * browser against the workspace's contact table (resolveSegment).
 */
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

  // Fetch the matching-contact count per segment so the list shows real
  // sizes instead of opaque "saved filter" rows.
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
    if (!confirm('¿Eliminar este segmento? Las difusiones que lo usen perderán la referencia.'))
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
            Listas dinámicas para usar en difusión y automatizaciones.
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

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando segmentos…
          </div>
        ) : segments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <Layers className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No tenés segmentos todavía. Creá uno para reutilizarlo en campañas y automatizaciones.
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
                        coincide {s.match_mode === 'all' ? 'todas' : 'alguna'}
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

  // Debounced live preview so the user sees the matching count update
  // as they tweak rules, without hammering Supabase on every keystroke.
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
      <DialogContent className="bg-card border-border text-foreground sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {segment.id ? 'Editar segmento' : 'Nuevo segmento'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1fr_280px]">
          <div className="space-y-4">
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
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Por ejemplo: clientes que compraron en los últimos 30 días"
                rows={2}
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground">Coincidencia</Label>
              <div className="flex items-center gap-4 text-sm text-foreground">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={matchMode === 'all'}
                    onChange={() => setMatchMode('all')}
                    className="accent-primary"
                  />
                  Cumple <span className="font-medium">todas</span> las reglas
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={matchMode === 'any'}
                    onChange={() => setMatchMode('any')}
                    className="accent-primary"
                  />
                  Cumple <span className="font-medium">alguna</span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground">Reglas</Label>
                <div className="flex flex-wrap items-center gap-1">
                  <RuleAddButton onClick={() => addRule('tag')} label="Etiqueta" />
                  <RuleAddButton onClick={() => addRule('channel')} label="Canal" />
                  <RuleAddButton onClick={() => addRule('created')} label="Fecha" />
                  <RuleAddButton onClick={() => addRule('text')} label="Texto" />
                  <RuleAddButton onClick={() => addRule('has_field')} label="Tiene dato" />
                  {customFields.length > 0 && (
                    <RuleAddButton
                      onClick={() => addRule('custom_field')}
                      label="Campo"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {rules.length === 0 && (
                  <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                    Sin reglas. Añadí una arriba para empezar a filtrar contactos.
                  </p>
                )}
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
            </div>
          </div>

          <aside className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Vista previa</span>
              {previewing && <Loader2 className="size-3 animate-spin" />}
            </div>
            <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {preview.length}
            </p>
            <p className="text-xs text-muted-foreground">
              de {total} contactos en el workspace
            </p>

            <div className="mt-3 max-h-[260px] space-y-1 overflow-y-auto pr-1">
              {preview.slice(0, 50).map((c) => (
                <div
                  key={c.id}
                  className="rounded-md bg-card/80 px-2 py-1.5 text-xs"
                >
                  <p className="truncate text-foreground">
                    {c.name || c.email || c.phone || c.external_id || 'Sin nombre'}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {c.email || c.phone || c.channel}
                  </p>
                </div>
              ))}
              {preview.length > 50 && (
                <p className="px-2 text-[10px] text-muted-foreground">
                  +{preview.length - 50} más…
                </p>
              )}
            </div>
          </aside>
        </div>

        <DialogFooter className="bg-card border-border">
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

function RuleAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="h-7 border-border px-2 text-xs text-foreground hover:bg-accent"
    >
      <Plus className="size-3" />
      {label}
    </Button>
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
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-2">
      <RuleBody rule={rule} tags={tags} customFields={customFields} onChange={onChange} />
      <button
        onClick={onRemove}
        title="Quitar regla"
        className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function RuleBody({
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
          <Chip>Etiqueta</Chip>
          <MiniSelect
            value={rule.op}
            options={[
              { value: 'has', label: 'tiene' },
              { value: 'not_has', label: 'no tiene' },
            ]}
            onChange={(v) => onChange({ ...rule, op: v as 'has' | 'not_has' })}
          />
          <MiniSelect
            value={rule.tagId}
            options={tags.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => onChange({ ...rule, tagId: v })}
            placeholder="Etiqueta…"
          />
        </>
      );
    case 'channel':
      return (
        <>
          <Chip>Canal</Chip>
          <MiniSelect
            value={rule.op}
            options={[
              { value: 'is', label: 'es' },
              { value: 'is_not', label: 'no es' },
            ]}
            onChange={(v) => onChange({ ...rule, op: v as 'is' | 'is_not' })}
          />
          <MiniSelect
            value={rule.channel}
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
          <Chip>Creado</Chip>
          <MiniSelect
            value={rule.op}
            options={[
              { value: 'last_n_days', label: 'hace menos de (días)' },
              { value: 'after', label: 'después de' },
              { value: 'before', label: 'antes de' },
            ]}
            onChange={(v) =>
              onChange({
                ...rule,
                op: v as 'last_n_days' | 'before' | 'after',
                value: v === 'last_n_days' ? '30' : new Date().toISOString().slice(0, 10),
              })
            }
          />
          {rule.op === 'last_n_days' ? (
            <Input
              type="number"
              min={1}
              value={rule.value}
              onChange={(e) => onChange({ ...rule, value: e.target.value })}
              className="h-7 w-24 bg-background text-xs"
            />
          ) : (
            <Input
              type="date"
              value={rule.value.slice(0, 10)}
              onChange={(e) => onChange({ ...rule, value: e.target.value })}
              className="h-7 w-40 bg-background text-xs"
            />
          )}
        </>
      );
    case 'has_field':
      return (
        <>
          <Chip>Tiene</Chip>
          <MiniSelect
            value={rule.field}
            options={FIELDS.map((f) => ({ value: f.value, label: f.label.toLowerCase() }))}
            onChange={(v) =>
              onChange({ ...rule, field: v as 'name' | 'email' | 'phone' | 'company' })
            }
          />
          <MiniSelect
            value={rule.op}
            options={[
              { value: 'present', label: 'definido' },
              { value: 'missing', label: 'vacío' },
            ]}
            onChange={(v) => onChange({ ...rule, op: v as 'present' | 'missing' })}
          />
        </>
      );
    case 'text':
      return (
        <>
          <Chip>{FIELDS.find((f) => f.value === rule.field)?.label ?? rule.field}</Chip>
          <MiniSelect
            value={rule.field}
            options={FIELDS.map((f) => ({ value: f.value, label: f.label.toLowerCase() }))}
            onChange={(v) =>
              onChange({ ...rule, field: v as 'name' | 'email' | 'phone' | 'company' })
            }
          />
          <MiniSelect
            value={rule.op}
            options={[
              { value: 'contains', label: 'contiene' },
              { value: 'equals', label: 'es igual a' },
              { value: 'starts_with', label: 'empieza con' },
            ]}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'contains' | 'equals' | 'starts_with' })
            }
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder="texto"
            className="h-7 w-40 bg-background text-xs"
          />
        </>
      );
    case 'custom_field':
      return (
        <>
          <Chip>Campo</Chip>
          <MiniSelect
            value={rule.fieldId}
            options={customFields.map((f) => ({ value: f.id, label: f.field_name }))}
            onChange={(v) => onChange({ ...rule, fieldId: v })}
            placeholder="Campo…"
          />
          <MiniSelect
            value={rule.op}
            options={[
              { value: 'equals', label: 'es' },
              { value: 'not_equals', label: 'no es' },
              { value: 'contains', label: 'contiene' },
            ]}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'equals' | 'not_equals' | 'contains' })
            }
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder="valor"
            className="h-7 w-40 bg-background text-xs"
          />
        </>
      );
    default:
      return null;
  }
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
      {children}
    </span>
  );
}

function MiniSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className="h-7 min-w-[8rem] bg-background text-xs">
        <SelectValue placeholder={placeholder} />
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

export type { ContactSegment as ContactSegmentExport, SegmentRule as SegmentRuleExport };
// Suppress unused warning for icon set
void RefreshCw;
