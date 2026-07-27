'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { escapeLike } from '@/lib/security/like';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, Channel } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { SegmentsPanel, SegmentEditor } from '@/components/contacts/segments-panel';
import { TagsPanel } from '@/components/contacts/tags-panel';
import type { SegmentRule } from '@/lib/segments/types';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';

const PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

/**
 * Ordena las etiquetas por color para que el filtro se lea como una
 * paleta organizada: los mismos colores quedan juntos y los matices
 * fluyen por tono (HSL). Desempata por nombre con orden numérico
 * natural, así "oferta: 1 / 2 / 3" y "unidades: 1 / 2-3 / 4+" mantienen
 * su secuencia. Grises e hex inválidos van al final.
 */
function sortTagsByHue(tags: Tag[]): Tag[] {
  const toHsl = (hex: string | null | undefined) => {
    let h = String(hex ?? '').replace('#', '').trim().toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/.test(h)) return { h: 999, s: 0, l: 0 };
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let hue = 0;
    let s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r:
          hue = ((g - b) / d) % 6;
          break;
        case g:
          hue = (b - r) / d + 2;
          break;
        default:
          hue = (r - g) / d + 4;
      }
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { h: d === 0 ? 999 : hue, s, l };
  };
  return [...tags].sort((a, b) => {
    const A = toHsl(a.color);
    const B = toHsl(b.color);
    return (
      A.h - B.h ||
      A.s - B.s ||
      A.l - B.l ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
  });
}

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const supabase = createClient();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? null;
  const t = useT();
  const fmt = useFormat();

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  // Selección para exportar. Set de ids seleccionados (a través de páginas).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  // Diálogo de export: elegir qué columnas se incluyen en el CSV.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCols, setExportCols] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMNS.map((c) => c.key)),
  );
  // "Guardar como segmento" — abre el editor con las reglas derivadas del filtro.
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<'list' | 'tags' | 'segments'>(() => {
    if (typeof window === 'undefined') return 'list';
    const param = new URLSearchParams(window.location.search).get('tab');
    if (param === 'segments') return 'segments';
    if (param === 'tags') return 'tags';
    return 'list';
  });

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
    }
  }, [supabase]);

  const [datePreset, setDatePreset] = useState<'all' | '7d' | '30d' | '90d'>(
    'all',
  );
  // Filtros visibles (dropdowns). Para segmentaciones más ricas (gasto, pedidos,
  // país…) está la pestaña Segmentos + "Guardar como segmento".
  const [shopifyFilter, setShopifyFilter] = useState<'all' | 'customers' | 'non'>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [hasFilter, setHasFilter] = useState<'all' | 'phone' | 'email'>('all');

  const fetchContacts = useCallback(async () => {
    // Wait for the workspace to resolve — otherwise without an
    // explicit workspace_id filter, RLS would still surface contacts
    // from every workspace the user belongs to.
    if (!workspaceId) return;
    setLoading(true);

    const from = page * pageSize;
    const to = from + pageSize - 1;

    // Filtro por etiquetas: trae los contactos que tienen cualquiera de
    // las etiquetas seleccionadas (semántica "alguna"), luego restringe.
    let taggedIds: string[] | null = null;
    if (selectedTagIds.length > 0) {
      const { data: links } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', selectedTagIds);
      taggedIds = [...new Set((links ?? []).map((l) => l.contact_id))];
      if (taggedIds.length === 0) {
        setContacts([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
    }

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (taggedIds) {
      query = query.in('id', taggedIds);
    }

    // Date filter on created_at (Todo / 7d / 30d / 90d).
    const dateDays =
      datePreset === '7d' ? 7 : datePreset === '30d' ? 30 : datePreset === '90d' ? 90 : 0;
    if (dateDays > 0) {
      query = query.gte(
        'created_at',
        new Date(Date.now() - dateDays * 24 * 60 * 60 * 1000).toISOString(),
      );
    }

    // Filtro por cliente Shopify.
    if (shopifyFilter === 'customers') query = query.eq('is_shopify_customer', true);
    else if (shopifyFilter === 'non') query = query.eq('is_shopify_customer', false);

    // Filtro por canal de origen.
    if (channelFilter !== 'all') query = query.eq('channel', channelFilter);

    // Filtro por dato de contacto disponible.
    if (hasFilter === 'phone') query = query.not('phone', 'is', null);
    else if (hasFilter === 'email') query = query.not('email', 'is', null);

    // Saneamos el término del usuario antes de interpolarlo en el filtro `.or()`:
    // (1) quitamos los caracteres de la gramática PostgREST `.or()` que NO son
    //     escapables ahí (`,` `(` `)` `:` `*` y `\`), y
    // (2) escapamos los comodines ilike (`%` `_`) con escapeLike para tratarlos
    //     como literales — sin esto, `juan_perez` no matchearía su propio `_`.
    // La query ya está acotada por workspace_id + RLS.
    const rawSearch = search.trim();
    if (rawSearch) {
      const cleaned = rawSearch.replace(/[,()\\:*]/g, ' ').trim();
      if (!cleaned) {
        // Término compuesto solo por caracteres saneados: sin resultados, en
        // vez de listar todo el workspace.
        setContacts([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
      const term = `%${escapeLike(cleaned)}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    const { data, count, error } = await query;

    if (error) {
      toast.error(t('contacts.loadContactsError'));
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    if (!data || data.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = data.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = data.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [supabase, page, pageSize, search, tagsMap, selectedTagIds, datePreset, shopifyFilter, channelFilter, hasFilter, workspaceId, t]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error(t('contacts.deleteContactError'));
    } else {
      toast.success(t('contacts.contactDeleted'));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // --- Selección + exportación CSV ---
  const pageIds = contacts.map((c) => c.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Selecciona TODOS los que cumplen el filtro actual (a través de páginas).
  async function selectAllMatching() {
    if (!workspaceId) return;
    let taggedIds: string[] | null = null;
    if (selectedTagIds.length > 0) {
      const { data: links } = await supabase
        .from('contact_tags').select('contact_id').in('tag_id', selectedTagIds);
      taggedIds = [...new Set((links ?? []).map((l) => l.contact_id))];
    }
    let q = supabase.from('contacts').select('id').eq('workspace_id', workspaceId).limit(10000);
    if (taggedIds) q = q.in('id', taggedIds);
    const dateDays = datePreset === '7d' ? 7 : datePreset === '30d' ? 30 : datePreset === '90d' ? 90 : 0;
    if (dateDays > 0) q = q.gte('created_at', new Date(Date.now() - dateDays * 864e5).toISOString());
    const rawSearch = search.trim();
    if (rawSearch) {
      const cleaned = rawSearch.replace(/[,()\\:*]/g, ' ').trim();
      if (cleaned) { const term = `%${escapeLike(cleaned)}%`; q = q.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`); }
    }
    const { data } = await q;
    setSelectedIds(new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id)));
  }

  async function exportCsv() {
    if (!workspaceId || selectedIds.size === 0) return;
    setExporting(true);
    try {
      // Traemos las filas completas (incluida la data de Shopify) por lotes.
      const ids = [...selectedIds];
      const rows: Contact[] = [];
      for (let i = 0; i < ids.length; i += 500) {
        const { data } = await supabase
          .from('contacts').select('*').in('id', ids.slice(i, i + 500));
        rows.push(...((data ?? []) as Contact[]));
      }
      // Etiquetas por contacto para incluirlas en el CSV.
      const { data: cts } = await supabase
        .from('contact_tags').select('contact_id, tag_id').in('contact_id', ids);
      const tagsByContact: Record<string, string[]> = {};
      (cts ?? []).forEach((ct) => {
        const name = tagsMap[ct.tag_id]?.name;
        if (!name) return;
        (tagsByContact[ct.contact_id] ??= []).push(name);
      });
      // Solo las columnas elegidas por el usuario, en el orden del catálogo.
      const cols = EXPORT_COLUMNS.filter((c) => exportCols.has(c.key)).map((c) => ({
        header: t(c.labelKey),
        get: c.get,
      }));
      downloadContactsCsv(rows, tagsByContact, fmt, cols);
      toast.success(t('contacts.exported', { count: rows.length }));
      setExportOpen(false);
    } catch {
      toast.error(t('contacts.exportError'));
    } finally {
      setExporting(false);
    }
  }

  // Un segmento es "un filtro guardado". Mapeamos el filtro actual (fecha +
  // etiquetas) a reglas del segmento; el editor muestra el conteo real en vivo
  // antes de guardar, así queda preciso. (La búsqueda es ad-hoc → no se guarda.)
  const filtersActive =
    selectedTagIds.length > 0 ||
    datePreset !== 'all' ||
    shopifyFilter !== 'all' ||
    channelFilter !== 'all' ||
    hasFilter !== 'all';
  function draftSegment() {
    const rules: SegmentRule[] = [];
    if (datePreset !== 'all') {
      rules.push({
        type: 'created',
        op: 'last_n_days',
        value: datePreset === '7d' ? '7' : datePreset === '30d' ? '30' : '90',
      });
    }
    if (shopifyFilter !== 'all') {
      rules.push({
        type: 'shopify',
        op: shopifyFilter === 'customers' ? 'is_customer' : 'is_not_customer',
      });
    }
    if (channelFilter !== 'all') {
      rules.push({ type: 'channel', op: 'is', channel: channelFilter as Channel });
    }
    if (hasFilter !== 'all') {
      rules.push({ type: 'has_field', field: hasFilter, op: 'present' });
    }
    for (const tid of selectedTagIds) rules.push({ type: 'tag', op: 'has', tagId: tid });
    return { name: '', description: '', rules, match_mode: 'all' as const };
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('contacts.title')}</h1>
          {totalCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {t('contacts.totalCount', { count: totalCount })}
            </p>
          )}
        </div>
        {tab === 'list' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              className="border-border text-foreground hover:bg-accent"
            >
              <Upload className="size-4" />
              {t('contacts.import')}
            </Button>
            <Button
              onClick={openAddForm}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="size-4" />
              {t('contacts.addContact')}
            </Button>
          </div>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        <button
          onClick={() => setTab('list')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            tab === 'list'
              ? 'bg-accent text-accent-ink'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('contacts.tabContacts')}
        </button>
        <button
          onClick={() => setTab('tags')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            tab === 'tags'
              ? 'bg-accent text-accent-ink'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('contacts.tabTags')}
        </button>
        <button
          onClick={() => setTab('segments')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            tab === 'segments'
              ? 'bg-accent text-accent-ink'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('contacts.tabSegments')}
        </button>
      </div>

      {tab === 'segments' ? (
        <SegmentsPanel />
      ) : tab === 'tags' ? (
        <TagsPanel />
      ) : <>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Reset pagination when the query changes — the result
            // set shrinks/grows, page N may no longer be valid.
            setPage(0);
          }}
          placeholder={t('contacts.searchPlaceholder')}
          className="pl-8 bg-muted border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Filtros (dropdowns): fecha · Shopify · canal · dato de contacto */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={datePreset}
          onChange={(v) => {
            setDatePreset(v as 'all' | '7d' | '30d' | '90d');
            setPage(0);
          }}
          options={[
            { value: 'all', label: t('contacts.filterAnyDate') },
            { value: '7d', label: t('contacts.actRange7') },
            { value: '30d', label: t('contacts.actRange30') },
            { value: '90d', label: t('contacts.actRange90') },
          ]}
        />
        <FilterSelect
          value={shopifyFilter}
          onChange={(v) => {
            setShopifyFilter(v as 'all' | 'customers' | 'non');
            setPage(0);
          }}
          options={[
            { value: 'all', label: t('contacts.filterAnyShopify') },
            { value: 'customers', label: t('contacts.shopFilterCustomers') },
            { value: 'non', label: t('contacts.shopFilterNon') },
          ]}
        />
        <FilterSelect
          value={channelFilter}
          onChange={(v) => {
            setChannelFilter(v);
            setPage(0);
          }}
          options={[
            { value: 'all', label: t('contacts.filterAnyChannel') },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'instagram', label: 'Instagram' },
            { value: 'messenger', label: 'Messenger' },
            { value: 'ig_comment', label: t('contacts.filterChIgComment') },
            { value: 'fb_comment', label: t('contacts.filterChFbComment') },
            { value: 'voice', label: t('contacts.filterChVoice') },
            { value: 'mercadolibre', label: 'Mercado Libre' },
            { value: 'gmail', label: 'Gmail' },
            { value: 'outlook', label: 'Outlook' },
          ]}
        />
        <FilterSelect
          value={hasFilter}
          onChange={(v) => {
            setHasFilter(v as 'all' | 'phone' | 'email');
            setPage(0);
          }}
          options={[
            { value: 'all', label: t('contacts.filterAnyContact') },
            { value: 'phone', label: t('contacts.filterHasPhone') },
            { value: 'email', label: t('contacts.filterHasEmail') },
          ]}
        />
      </div>

      {/* Tag filter */}
      {Object.keys(tagsMap).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {sortTagsByHue(Object.values(tagsMap)).map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            const color = tag.color ?? '#64748b';
            return (
              <button
                key={tag.id}
                onClick={() => {
                  setSelectedTagIds((prev) =>
                    prev.includes(tag.id)
                      ? prev.filter((id) => id !== tag.id)
                      : [...prev, tag.id],
                  );
                  setPage(0);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all hover:-translate-y-px"
                style={
                  active
                    ? {
                        backgroundColor: `${color}33`,
                        color,
                        borderColor: color,
                        boxShadow: `inset 0 0 0 1px ${color}`,
                      }
                    : {
                        backgroundColor: `${color}1f`,
                        color,
                        borderColor: `${color}52`,
                      }
                }
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {tag.name}
              </button>
            );
          })}
          {selectedTagIds.length > 0 && (
            <button
              onClick={() => {
                setSelectedTagIds([]);
                setPage(0);
              }}
              className="ml-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('contacts.clear')}
            </button>
          )}
        </div>
      )}

      {/* Guardar el filtro actual como segmento reutilizable */}
      {filtersActive && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSaveSegmentOpen(true)}
            className="border-border text-foreground hover:bg-accent"
          >
            <Layers className="size-4" />
            {t('contacts.saveAsSegment')}
          </Button>
        </div>
      )}

      {/* Barra de selección + exportar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-sm text-foreground">
            {t('contacts.selectedCount', { count: selectedIds.size })}
          </span>
          {selectedIds.size < totalCount && (
            <button
              type="button"
              onClick={selectAllMatching}
              className="text-xs font-medium text-accent-ink hover:underline"
            >
              {t('contacts.selectAllMatching', { count: totalCount })}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('contacts.clearSelection')}
          </button>
          <Button
            size="sm"
            onClick={() => setExportOpen(true)}
            className="ml-auto bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Download className="size-4" />
            {t('contacts.exportCsv')}
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label={t('contacts.selectPage')}
                  checked={allPageSelected}
                  onChange={togglePage}
                  className="size-4 cursor-pointer accent-primary"
                />
              </TableHead>
              <TableHead className="text-muted-foreground">{t('contacts.colName')}</TableHead>
              <TableHead className="text-muted-foreground">{t('contacts.colPhone')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('contacts.colEmail')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('contacts.colTags')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('contacts.colCreated')}</TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-accent-ink" />
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="text-center py-12">
                  {search || selectedTagIds.length > 0 ? (
                    <div className="flex flex-col items-center gap-2">
                      <Users className="size-8 text-muted-foreground" />
                      <p className="max-w-sm text-sm text-muted-foreground">
                        {t('contacts.noResults')}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Users className="size-8 text-muted-foreground" />
                      <p className="text-sm font-semibold text-foreground">
                        {t('contacts.noContactsTitle')}
                      </p>
                      <Button
                        onClick={openAddForm}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <Plus className="size-4" />
                        {t('contacts.addFirstContact')}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-accent cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                    <input
                      type="checkbox"
                      aria-label={t('contacts.selectOne')}
                      checked={selectedIds.has(contact.id)}
                      onChange={() => toggleOne(contact.id)}
                      className="size-4 cursor-pointer accent-primary"
                    />
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    <div className="flex items-center gap-2">
                      <span>
                        {contact.name || <span className="text-muted-foreground italic">{t('contacts.noName')}</span>}
                      </span>
                      {contact.is_shopify_customer && (
                        <span
                          aria-label={t('contacts.shopifyCustomer')}
                          title={t('contacts.shopifyCustomer')}
                          className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                        >
                          Shopify
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {contact.email || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                    {fmt.date(contact.created_at, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-card border-border"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-foreground focus:bg-accent focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          {t('contacts.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {t('contacts.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination + page size */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {t('contacts.paginationRange', {
                from: page * pageSize + 1,
                to: Math.min((page + 1) * pageSize, totalCount),
                total: totalCount,
              })}
            </p>
            {/* Tamaño de página: 25 / 50 / 100 */}
            <div className="inline-flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('contacts.perPage')}</span>
              {PAGE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    setPageSize(size);
                    setPage(0);
                  }}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
                    pageSize === size
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!hasPrev}
                onClick={() => setPage((p) => p - 1)}
                className="border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                {t('contacts.pageOf', { page: page + 1, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
                className="border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      </>}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={() => {
          fetchContacts();
          fetchTags();
        }}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Guardar filtro como segmento — reusa el editor de Segmentos con las
          reglas derivadas del filtro; su preview en vivo confirma el conteo. */}
      {saveSegmentOpen && workspaceId && (
        <SegmentEditor
          workspaceId={workspaceId}
          segment={draftSegment()}
          tags={Object.values(tagsMap)}
          customFields={[]}
          onClose={() => setSaveSegmentOpen(false)}
          onSaved={() => {
            setSaveSegmentOpen(false);
            toast.success(t('contacts.segmentSavedFromFilter'));
          }}
        />
      )}

      {/* Export column picker */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">{t('contacts.exportColumnsTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {t('contacts.exportColumnsHint', { count: selectedIds.size })}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-accent-ink hover:underline"
                  onClick={() => setExportCols(new Set(EXPORT_COLUMNS.map((c) => c.key)))}
                >
                  {t('contacts.selectAllCols')}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setExportCols(new Set())}
                >
                  {t('contacts.selectNoneCols')}
                </button>
              </div>
            </div>
            <div className="grid max-h-72 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto pr-1">
              {EXPORT_COLUMNS.map((col) => (
                <label key={col.key} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={exportCols.has(col.key)}
                    onChange={() =>
                      setExportCols((prev) => {
                        const next = new Set(prev);
                        if (next.has(col.key)) next.delete(col.key);
                        else next.add(col.key);
                        return next;
                      })
                    }
                    className="size-4 cursor-pointer accent-primary"
                  />
                  {t(col.labelKey)}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExportOpen(false)}
              className="border-border text-foreground hover:bg-accent"
            >
              {t('contacts.cancel')}
            </Button>
            <Button
              onClick={exportCsv}
              disabled={exporting || exportCols.size === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t('contacts.exportCsv')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {t('contacts.deleteContactQuestion', {
                name: deleteTarget?.name || deleteTarget?.phone || '',
              })}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter className="bg-card border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-foreground hover:bg-accent"
            >
              {t('contacts.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('contacts.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// --- Exportación CSV (columnas elegibles) ----------------------------------

type FmtLike = { date: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => string };

function sdOf(c: Contact): Record<string, unknown> | null {
  return (c as unknown as { shopify_customer_data?: Record<string, unknown> | null })
    .shopify_customer_data ?? null;
}
function addrOf(c: Contact): Record<string, unknown> | null {
  const s = sdOf(c);
  return (s?.default_address ?? s?.address ?? null) as Record<string, unknown> | null;
}

interface ExportColumn {
  key: string;
  labelKey: string;
  get: (c: Contact, tags: string[], fmt: FmtLike) => string;
}

/** Todas las columnas exportables. El usuario elige cuáles antes de exportar. */
const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'name', labelKey: 'contacts.colName', get: (c) => c.name ?? '' },
  { key: 'phone', labelKey: 'contacts.colPhone', get: (c) => c.phone ?? '' },
  { key: 'email', labelKey: 'contacts.colEmail', get: (c) => c.email ?? '' },
  { key: 'company', labelKey: 'contacts.colCompany', get: (c) => c.company ?? '' },
  { key: 'tags', labelKey: 'contacts.colTags', get: (_c, tags) => tags.join('; ') },
  { key: 'shopify', labelKey: 'contacts.shopifyCustomer', get: (c) => (c.is_shopify_customer ? 'Sí' : 'No') },
  { key: 'total_spent', labelKey: 'contacts.shopTotalSpent', get: (c) => String(sdOf(c)?.total_spent ?? sdOf(c)?.totalSpent ?? '') },
  { key: 'currency', labelKey: 'contacts.shopCurrency', get: (c) => String(sdOf(c)?.currency ?? '') },
  { key: 'orders', labelKey: 'contacts.shopOrders', get: (c) => String(sdOf(c)?.orders_count ?? sdOf(c)?.ordersCount ?? '') },
  { key: 'address', labelKey: 'contacts.shopAddress', get: (c) => { const a = addrOf(c); return a ? [a.address1, a.address2].filter(Boolean).join(' ') : ''; } },
  { key: 'city', labelKey: 'contacts.shopCity', get: (c) => String(addrOf(c)?.city ?? '') },
  { key: 'province', labelKey: 'contacts.shopProvince', get: (c) => String(addrOf(c)?.province ?? '') },
  { key: 'country', labelKey: 'contacts.shopCountry', get: (c) => String(addrOf(c)?.country ?? '') },
  { key: 'zip', labelKey: 'contacts.shopZip', get: (c) => String(addrOf(c)?.zip ?? '') },
  { key: 'channel', labelKey: 'contacts.colChannel', get: (c) => String((c as unknown as { channel?: string }).channel ?? '') },
  { key: 'created', labelKey: 'contacts.colCreated', get: (c, _tags, fmt) => (c.created_at ? fmt.date(c.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '') },
];

/** Escapa un valor para CSV (comillas, comas, saltos de línea). */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Descarga los contactos como CSV usando SOLO las columnas elegidas por el
 * usuario (en el orden de EXPORT_COLUMNS). BOM UTF-8 para que Excel abra bien
 * tildes/ñ.
 */
function downloadContactsCsv(
  rows: Contact[],
  tagsByContact: Record<string, string[]>,
  fmt: FmtLike,
  columns: Array<{ header: string; get: ExportColumn['get'] }>,
): void {
  const lines = [columns.map((col) => csvCell(col.header)).join(',')];
  for (const c of rows) {
    const tags = tagsByContact[c.id] ?? [];
    lines.push(columns.map((col) => csvCell(col.get(c, tags, fmt))).join(','));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contactos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Dropdown de filtro estilo pill (nativo, minimalista). */
function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="cursor-pointer rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
