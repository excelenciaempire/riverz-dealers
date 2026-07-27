'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock,
  CircleSlash,
  Database,
  Gift,
  History,
  DollarSign,
  Layers,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Tag as TagIcon,
  Trash2,
  Type as TypeIcon,
  Users,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import type { TFn } from '@/lib/i18n/translate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
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

// Channel display labels. Brand names stay literal; the comment channels
// carry an i18n key resolved with t() at the render site (sidebar pattern).
const CHANNEL_LABEL_KEYS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  gmail: 'Gmail',
  outlook: 'Outlook',
  fb_comment: 'contacts.channelFbComment',
  ig_comment: 'contacts.channelIgComment',
  mercadolibre: 'Mercado Libre',
  tiktok_comment: 'contacts.channelTiktokComment',
  voice: 'Voz',
};

/** Resolve channel labels for the current locale (brand names pass through). */
function channelLabels(t: TFn): Record<Channel, string> {
  const out = {} as Record<Channel, string>;
  for (const [channel, key] of Object.entries(CHANNEL_LABEL_KEYS) as [Channel, string][]) {
    out[channel] = key.startsWith('contacts.') ? t(key) : key;
  }
  return out;
}

// Field labels keyed by i18n key, resolved with t() at the render site.
const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'contacts.segFieldName',
  email: 'contacts.segFieldEmail',
  phone: 'contacts.segFieldPhone',
  company: 'contacts.segFieldCompany',
};

function fieldLabels(t: TFn): Record<string, string> {
  return {
    name: t(FIELD_LABEL_KEYS.name),
    email: t(FIELD_LABEL_KEYS.email),
    phone: t(FIELD_LABEL_KEYS.phone),
    company: t(FIELD_LABEL_KEYS.company),
  };
}

const FIELD_OPTIONS = [
  { value: 'name', labelKey: 'contacts.segFieldName' },
  { value: 'email', labelKey: 'contacts.segFieldEmail' },
  { value: 'phone', labelKey: 'contacts.segFieldPhone' },
  { value: 'company', labelKey: 'contacts.segFieldCompany' },
] as const;

// Rule type metadata: label + description carry i18n keys, resolved at the
// render site. Icon is a component, untranslated.
const RULE_TYPES: {
  type: SegmentRule['type'];
  labelKey: string;
  descriptionKey: string;
  Icon: typeof TagIcon;
}[] = [
  { type: 'tag', labelKey: 'contacts.ruleTagLabel', descriptionKey: 'contacts.ruleTagDesc', Icon: TagIcon },
  { type: 'channel', labelKey: 'contacts.ruleChannelLabel', descriptionKey: 'contacts.ruleChannelDesc', Icon: MessageCircle },
  { type: 'created', labelKey: 'contacts.ruleCreatedLabel', descriptionKey: 'contacts.ruleCreatedDesc', Icon: CalendarClock },
  { type: 'text', labelKey: 'contacts.ruleTextLabel', descriptionKey: 'contacts.ruleTextDesc', Icon: TypeIcon },
  { type: 'has_field', labelKey: 'contacts.ruleHasFieldLabel', descriptionKey: 'contacts.ruleHasFieldDesc', Icon: CircleSlash },
  { type: 'custom_field', labelKey: 'contacts.ruleCustomFieldLabel', descriptionKey: 'contacts.ruleCustomFieldDesc', Icon: Database },
  { type: 'shopify', labelKey: 'contacts.ruleShopifyLabel', descriptionKey: 'contacts.ruleShopifyDesc', Icon: ShoppingBag },
  { type: 'offer', labelKey: 'contacts.ruleOfferLabel', descriptionKey: 'contacts.ruleOfferDesc', Icon: Gift },
  { type: 'units', labelKey: 'contacts.ruleUnitsLabel', descriptionKey: 'contacts.ruleUnitsDesc', Icon: Package },
  { type: 'spend', labelKey: 'contacts.ruleSpendLabel', descriptionKey: 'contacts.ruleSpendDesc', Icon: DollarSign },
  { type: 'orders', labelKey: 'contacts.ruleOrdersLabel', descriptionKey: 'contacts.ruleOrdersDesc', Icon: ShoppingCart },
  { type: 'location', labelKey: 'contacts.ruleLocationLabel', descriptionKey: 'contacts.ruleLocationDesc', Icon: MapPin },
  { type: 'activity_date', labelKey: 'contacts.ruleActivityDateLabel', descriptionKey: 'contacts.ruleActivityDateDesc', Icon: History },
];

// Operator label i18n keys used by SelectValue.labels — shown human-readable
// on the trigger but stored as compact codes in the segment rules JSON.
const OP_LABEL_KEYS = {
  tag: { has: 'contacts.opTagHas', not_has: 'contacts.opTagNotHas' },
  channel: { is: 'contacts.opChannelIs', is_not: 'contacts.opChannelIsNot' },
  created: {
    last_n_days: 'contacts.opCreatedLastNDays',
    after: 'contacts.opCreatedAfter',
    before: 'contacts.opCreatedBefore',
  },
  has_field: { present: 'contacts.opHasFieldPresent', missing: 'contacts.opHasFieldMissing' },
  text: {
    contains: 'contacts.opTextContains',
    equals: 'contacts.opTextEquals',
    starts_with: 'contacts.opTextStartsWith',
  },
  custom_field: {
    equals: 'contacts.opCustomEquals',
    not_equals: 'contacts.opCustomNotEquals',
    contains: 'contacts.opCustomContains',
  },
  shopify: {
    is_customer: 'contacts.opShopifyIsCustomer',
    is_not_customer: 'contacts.opShopifyIsNotCustomer',
  },
  offer: {
    is: 'contacts.opOfferIs',
    is_not: 'contacts.opOfferIsNot',
    contains: 'contacts.opOfferContains',
    any: 'contacts.opOfferAny',
  },
  units: {
    eq: 'contacts.opUnitsEq',
    gte: 'contacts.opUnitsGte',
    lte: 'contacts.opUnitsLte',
    between: 'contacts.opUnitsBetween',
  },
  spend: {
    gte: 'contacts.opSpendGte',
    lte: 'contacts.opSpendLte',
    between: 'contacts.opSpendBetween',
  },
  orders: {
    eq: 'contacts.opOrdersEq',
    gte: 'contacts.opOrdersGte',
    lte: 'contacts.opOrdersLte',
    between: 'contacts.opOrdersBetween',
  },
  location: {
    is: 'contacts.opLocationIs',
    contains: 'contacts.opLocationContains',
  },
} as const;

/** Resolve a record of `{ code: i18nKey }` to `{ code: label }`. */
function resolveOpLabels(
  group: Record<string, string>,
  t: TFn,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [code, key] of Object.entries(group)) out[code] = t(key);
  return out;
}

export function SegmentsPanel() {
  const supabase = useMemo(() => createClient(), []);
  const { workspace } = useWorkspace();
  const t = useT();
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
    if (!confirm(t('contacts.deleteSegmentConfirm'))) return;
    setDeletingId(id);
    const { error } = await supabase.from('contact_segments').delete().eq('id', id);
    setDeletingId(null);
    if (error) {
      toast.error(t('contacts.deleteSegmentError', { error: error.message }));
      return;
    }
    toast.success(t('contacts.segmentDeleted'));
    await reload();
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('contacts.savedSegments')}</h2>
        </div>
        <Button
          onClick={startNew}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          {t('contacts.newSegment')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center p-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : segments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Layers className="size-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('contacts.noSegments')}
            </p>
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
                        {(s.rules?.length ?? 0) === 1
                          ? t('contacts.ruleCountSingular', { count: s.rules?.length ?? 0 })
                          : t('contacts.ruleCountPlural', { count: s.rules?.length ?? 0 })}
                        {' · '}
                        {s.match_mode === 'all'
                          ? t('contacts.matchesAll')
                          : t('contacts.matchesAny')}
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
                      title={t('contacts.edit')}
                      className="rounded p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      title={t('contacts.delete')}
                      className="rounded p-2.5 text-muted-foreground hover:bg-accent hover:text-red-400 disabled:opacity-50"
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

export interface EditorProps {
  workspaceId: string;
  segment: EditableSegment;
  tags: Tag[];
  customFields: CustomField[];
  onClose: () => void;
  /** Receives the saved row so callers (e.g. the campaign wizard) can select
   *  the just-created segment and continue. */
  onSaved: (saved?: ContactSegment) => void | Promise<void>;
}

/** Segment create/edit modal. Exported so it can be reused inline (e.g. in the
 *  campaign wizard) without routing to the contacts page. */
export function SegmentEditor({
  workspaceId,
  segment,
  tags,
  customFields,
  onClose,
  onSaved,
}: EditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const t = useT();
  const chLabels = useMemo(() => channelLabels(t), [t]);
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
          ? t('contacts.noTagsRule')
          : t('contacts.noCustomFieldsRule'),
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
      toast.error(t('contacts.missingName'));
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
    const { data: saved, error } = segment.id
      ? await supabase
          .from('contact_segments')
          .update(payload)
          .eq('id', segment.id)
          .select()
          .maybeSingle()
      : await supabase.from('contact_segments').insert(payload).select().maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(t('contacts.saveSegmentError', { error: error.message }));
      return;
    }
    toast.success(segment.id ? t('contacts.segmentUpdated') : t('contacts.segmentCreated'));
    await onSaved((saved as ContactSegment | null) ?? undefined);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-card p-0 text-foreground sm:max-w-3xl lg:max-w-5xl"
        showCloseButton={false}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <DialogTitle className="text-base font-semibold text-foreground">
              {segment.id ? t('contacts.editSegment') : t('contacts.newSegment')}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('contacts.close')}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 gap-0 overflow-y-auto sm:overflow-hidden sm:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5 overflow-y-auto p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-foreground">{t('contacts.fieldName')}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('contacts.segmentNamePlaceholder')}
                  className="bg-background"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-foreground">{t('contacts.fieldDescription')}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('contacts.segmentDescriptionPlaceholder')}
                  className="bg-background"
                />
              </div>
            </div>

            {/* Match mode as a segmented control */}
            <div className="space-y-1.5">
              <Label className="text-foreground">{t('contacts.matchLabel')}</Label>
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                <MatchModeButton
                  active={matchMode === 'all'}
                  onClick={() => setMatchMode('all')}
                  title={t('contacts.matchAllTitle')}
                  subtitle={t('contacts.matchAllSubtitle')}
                />
                <MatchModeButton
                  active={matchMode === 'any'}
                  onClick={() => setMatchMode('any')}
                  title={t('contacts.matchAnyTitle')}
                  subtitle={t('contacts.matchAnySubtitle')}
                />
              </div>
            </div>

            {/* Rules block */}
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">{t('contacts.rules')}</p>
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
          <aside className="overflow-y-auto border-t border-border bg-muted/30 p-4 sm:border-l sm:border-t-0">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('contacts.preview')}</span>
              {previewing && <Loader2 className="size-3 animate-spin" />}
            </div>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
              {preview.length}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('contacts.previewOf', { total })}
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
                      t('contacts.segmentNoName')}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {c.email ||
                      c.phone ||
                      chLabels[c.channel as Channel] ||
                      c.channel}
                  </p>
                </div>
              ))}
              {preview.length > 50 && (
                <p className="px-2 text-[10px] text-muted-foreground">
                  {t('contacts.morePreview', { count: preview.length - 50 })}
                </p>
              )}
              {preview.length === 0 && !previewing && (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                  {t('contacts.noContactMatches')}
                </p>
              )}
            </div>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-6 py-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-border text-foreground hover:bg-accent"
          >
            {t('contacts.cancel')}
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('contacts.save')}
          </Button>
        </div>
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
  const t = useT();
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
        {t('contacts.addRule')}
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
                <p className="text-sm font-medium text-foreground">{t(r.labelKey)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t(r.descriptionKey)}
                  {disabled ? t('contacts.noCustomFieldsHint') : ''}
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
  const t = useT();
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
          title={t('contacts.removeRule')}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-400"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function RuleHeader({ rule }: { rule: SegmentRule }) {
  const t = useT();
  const meta = RULE_TYPES.find((r) => r.type === rule.type);
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
      <meta.Icon className="size-3" />
      {t(meta.labelKey)}
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
  const t = useT();
  const fLabels = fieldLabels(t);
  const fOptions = FIELD_OPTIONS.map((f) => ({
    value: f.value,
    label: t(f.labelKey).toLowerCase(),
  }));
  switch (rule.type) {
    case 'tag': {
      const opTag = resolveOpLabels(OP_LABEL_KEYS.tag, t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opTag}
            options={Object.entries(opTag).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'has' | 'not_has' })}
          />
          <MiniSelect
            value={rule.tagId}
            labels={Object.fromEntries(tags.map((tg) => [tg.id, tg.name]))}
            options={tags.map((tg) => ({ value: tg.id, label: tg.name }))}
            onChange={(v) => onChange({ ...rule, tagId: v })}
            placeholder={t('contacts.tagPlaceholder')}
          />
        </>
      );
    }
    case 'channel': {
      const opChannel = resolveOpLabels(OP_LABEL_KEYS.channel, t);
      const chLabels = channelLabels(t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opChannel}
            options={Object.entries(opChannel).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'is' | 'is_not' })}
          />
          <MiniSelect
            value={rule.channel}
            labels={chLabels}
            options={(Object.keys(chLabels) as Channel[]).map((c) => ({
              value: c,
              label: chLabels[c],
            }))}
            onChange={(v) => onChange({ ...rule, channel: v as Channel })}
          />
        </>
      );
    }
    case 'created': {
      const opCreated = resolveOpLabels(OP_LABEL_KEYS.created, t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opCreated}
            options={Object.entries(opCreated).map(([v, l]) => ({ value: v, label: l }))}
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
              <span className="text-xs text-muted-foreground">{t('contacts.daysWord')}</span>
            </div>
          ) : (
            <Input
              type="date"
              value={rule.value.slice(0, 10)}
              onChange={(e) => onChange({ ...rule, value: e.target.value })}
              className="h-8 w-full sm:w-40 bg-background text-xs"
            />
          )}
        </>
      );
    }
    case 'has_field': {
      const opHasField = resolveOpLabels(OP_LABEL_KEYS.has_field, t);
      return (
        <>
          <span className="text-xs text-muted-foreground">{t('contacts.theWord')}</span>
          <MiniSelect
            value={rule.field}
            labels={fLabels}
            options={fOptions}
            onChange={(v) =>
              onChange({
                ...rule,
                field: v as 'name' | 'email' | 'phone' | 'company',
              })
            }
          />
          <MiniSelect
            value={rule.op}
            labels={opHasField}
            options={Object.entries(opHasField).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'present' | 'missing' })}
          />
        </>
      );
    }
    case 'text': {
      const opText = resolveOpLabels(OP_LABEL_KEYS.text, t);
      return (
        <>
          <MiniSelect
            value={rule.field}
            labels={fLabels}
            options={fOptions}
            onChange={(v) =>
              onChange({
                ...rule,
                field: v as 'name' | 'email' | 'phone' | 'company',
              })
            }
          />
          <MiniSelect
            value={rule.op}
            labels={opText}
            options={Object.entries(opText).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'contains' | 'equals' | 'starts_with' })
            }
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder={t('contacts.textPlaceholder')}
            className="h-8 w-full sm:w-44 bg-background text-xs"
          />
        </>
      );
    }
    case 'custom_field': {
      const cfLabels = Object.fromEntries(
        customFields.map((f) => [f.id, f.field_name]),
      );
      const opCustom = resolveOpLabels(OP_LABEL_KEYS.custom_field, t);
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
            placeholder={t('contacts.fieldPlaceholder')}
          />
          <MiniSelect
            value={rule.op}
            labels={opCustom}
            options={Object.entries(opCustom).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'equals' | 'not_equals' | 'contains' })
            }
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder={t('contacts.valuePlaceholder')}
            className="h-8 w-full sm:w-44 bg-background text-xs"
          />
        </>
      );
    }
    case 'shopify': {
      const opShopify = resolveOpLabels(OP_LABEL_KEYS.shopify, t);
      return (
        <MiniSelect
          value={rule.op}
          labels={opShopify}
          options={Object.entries(opShopify).map(([v, l]) => ({ value: v, label: l }))}
          onChange={(v) =>
            onChange({ ...rule, op: v as 'is_customer' | 'is_not_customer' })
          }
        />
      );
    }
    case 'offer': {
      const opOffer = resolveOpLabels(OP_LABEL_KEYS.offer, t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opOffer}
            options={Object.entries(opOffer).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'is' | 'is_not' | 'contains' | 'any' })
            }
          />
          {rule.op !== 'any' && (
            <Input
              value={rule.value}
              onChange={(e) => onChange({ ...rule, value: e.target.value })}
              placeholder={t('contacts.offerPlaceholder')}
              className="h-8 w-full sm:w-44 bg-background text-xs"
            />
          )}
        </>
      );
    }
    case 'activity_date': {
      const opCreated = resolveOpLabels(OP_LABEL_KEYS.created, t);
      const actLabels: Record<string, string> = {
        last_purchase: t('contacts.actFieldLastPurchase'),
        last_activity: t('contacts.actFieldLastActivity'),
        last_ai: t('contacts.actFieldLastAi'),
      };
      return (
        <>
          <MiniSelect
            value={rule.field}
            labels={actLabels}
            options={Object.entries(actLabels).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({
                ...rule,
                field: v as 'last_purchase' | 'last_activity' | 'last_ai',
              })
            }
          />
          <MiniSelect
            value={rule.op}
            labels={opCreated}
            options={Object.entries(opCreated).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({
                ...rule,
                op: v as 'last_n_days' | 'before' | 'after',
                value:
                  v === 'last_n_days'
                    ? '30'
                    : new Date().toISOString().slice(0, 10),
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
              <span className="text-xs text-muted-foreground">{t('contacts.daysWord')}</span>
            </div>
          ) : (
            <Input
              type="date"
              value={rule.value.slice(0, 10)}
              onChange={(e) => onChange({ ...rule, value: e.target.value })}
              className="h-8 w-full sm:w-40 bg-background text-xs"
            />
          )}
        </>
      );
    }
    case 'units': {
      const opUnits = resolveOpLabels(OP_LABEL_KEYS.units, t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opUnits}
            options={Object.entries(opUnits).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) =>
              onChange({ ...rule, op: v as 'eq' | 'gte' | 'lte' | 'between' })
            }
          />
          <Input
            type="number"
            min={0}
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
            className="h-8 w-20 bg-background text-xs"
          />
          {rule.op === 'between' && (
            <>
              <span className="text-xs text-muted-foreground">
                {t('contacts.unitsAndWord')}
              </span>
              <Input
                type="number"
                min={0}
                value={rule.value2 ?? ''}
                onChange={(e) =>
                  onChange({ ...rule, value2: Number(e.target.value) })
                }
                className="h-8 w-20 bg-background text-xs"
              />
            </>
          )}
        </>
      );
    }
    case 'spend': {
      const opSpend = resolveOpLabels(OP_LABEL_KEYS.spend, t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opSpend}
            options={Object.entries(opSpend).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'gte' | 'lte' | 'between' })}
          />
          <Input
            type="number"
            min={0}
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
            className="h-8 w-24 bg-background text-xs"
          />
          {rule.op === 'between' && (
            <>
              <span className="text-xs text-muted-foreground">{t('contacts.unitsAndWord')}</span>
              <Input
                type="number"
                min={0}
                value={rule.value2 ?? ''}
                onChange={(e) => onChange({ ...rule, value2: Number(e.target.value) })}
                className="h-8 w-24 bg-background text-xs"
              />
            </>
          )}
        </>
      );
    }
    case 'orders': {
      const opOrders = resolveOpLabels(OP_LABEL_KEYS.orders, t);
      return (
        <>
          <MiniSelect
            value={rule.op}
            labels={opOrders}
            options={Object.entries(opOrders).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'eq' | 'gte' | 'lte' | 'between' })}
          />
          <Input
            type="number"
            min={0}
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
            className="h-8 w-20 bg-background text-xs"
          />
          {rule.op === 'between' && (
            <>
              <span className="text-xs text-muted-foreground">{t('contacts.unitsAndWord')}</span>
              <Input
                type="number"
                min={0}
                value={rule.value2 ?? ''}
                onChange={(e) => onChange({ ...rule, value2: Number(e.target.value) })}
                className="h-8 w-20 bg-background text-xs"
              />
            </>
          )}
        </>
      );
    }
    case 'location': {
      const opLoc = resolveOpLabels(OP_LABEL_KEYS.location, t);
      const fieldLabels: Record<string, string> = {
        country: t('contacts.locationCountry'),
        city: t('contacts.locationCity'),
      };
      return (
        <>
          <MiniSelect
            value={rule.field}
            labels={fieldLabels}
            options={Object.entries(fieldLabels).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, field: v as 'country' | 'city' })}
          />
          <MiniSelect
            value={rule.op}
            labels={opLoc}
            options={Object.entries(opLoc).map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange({ ...rule, op: v as 'is' | 'contains' })}
          />
          <Input
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
            placeholder={t('contacts.locationPlaceholder')}
            className="h-8 w-36 bg-background text-xs"
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
      <SelectTrigger className="h-8 w-full sm:w-auto sm:min-w-[8rem] bg-background text-xs">
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
    case 'shopify':
      return { type: 'shopify', op: 'is_customer' };
    case 'offer':
      return { type: 'offer', op: 'any', value: '' };
    case 'units':
      return { type: 'units', op: 'gte', value: 1 };
    case 'spend':
      return { type: 'spend', op: 'gte', value: 0 };
    case 'orders':
      return { type: 'orders', op: 'gte', value: 1 };
    case 'location':
      return { type: 'location', field: 'country', op: 'is', value: '' };
    case 'activity_date':
      return { type: 'activity_date', field: 'last_purchase', op: 'last_n_days', value: '30' };
  }
}

void Textarea;
