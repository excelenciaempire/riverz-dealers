'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { createClient } from '@/lib/supabase/client';
import { escapeLike } from '@/lib/security/like';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
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
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { DateAddedFilter, type DatePreset } from '@/components/contacts/date-added-filter';
import { FilterMultiSelect } from '@/components/contacts/filter-chip';
import {
  ExportColumnsDialog,
  downloadContactsCsv,
  tagNamesByContact,
  type ResolvedColumn,
} from '@/components/contacts/contacts-export';
import type { CustomRange } from '@/components/dashboard/date-range-filter';
import { dateChipBounds } from '@/components/common/date-range-chip';
import { ImportModal } from '@/components/contacts/import-modal';
import { SegmentsPanel } from '@/components/contacts/segments-panel';
import { TagsPanel } from '@/components/contacts/tags-panel';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimezone } from '@/hooks/use-timezone';
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

/**
 * Lo mínimo que necesita una consulta de Supabase para que le apliquemos los
 * filtros de la lista. Estructural a propósito: así el mismo filtro sirve para
 * traer la página de la tabla (`select('*')`) y para seleccionar todos los que
 * coinciden (`select('id')`) sin duplicar la lógica.
 */
interface FilterableQuery {
  in(column: string, values: string[]): FilterableQuery;
  gte(column: string, value: string): FilterableQuery;
  lt(column: string, value: string): FilterableQuery;
  eq(column: string, value: string | boolean): FilterableQuery;
  or(filters: string): FilterableQuery;
}

export default function ContactsPage() {
  const supabase = createClient();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? null;
  const t = useT();
  const fmt = useFormat();
  const tz = useTimezone();

  // Sin memoria entre visitas, a diferencia del resto de las listas: acá lo que
  // se ve depende de la página, la búsqueda y las etiquetas elegidas, y todo
  // eso vuelve a cero al montar. Mostrar las filas guardadas debajo de un
  // "página 1, sin filtros" recién reseteado sería enseñar algo que no
  // corresponde a los controles de al lado.
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

  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  /** Rango a medida elegido en el calendario (sólo con datePreset==='custom'). */
  const [dateCustom, setDateCustom] = useState<CustomRange | null>(null);
  // Filtros visibles. Cada uno admite varias opciones a la vez; lista vacía =
  // no filtra. Para segmentaciones más ricas (gasto, pedidos, país…) está la
  // pestaña Segmentos.
  const [shopifyFilter, setShopifyFilter] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<string[]>([]);

  /**
   * Los filtros de la lista, en un solo lugar.
   *
   * La lógica es una sola y vale para todo: cada dimensión (búsqueda · alta ·
   * Shopify · canal · etiquetas) se SUMA a las demás — "Shopify: compraron" +
   * "Canal: Instagram" = los que compraron Y llegaron por Instagram —; dentro
   * de las etiquetas basta con tener alguna de las marcadas. Esta misma query
   * la usan la tabla y "seleccionar todos los que coinciden", que antes se
   * saltaba los desplegables y llegaba a seleccionar contactos que la lista no
   * mostraba.
   *
   * Devuelve `null` cuando el filtro ya no puede coincidir con nadie (búsqueda
   * que se queda vacía al sanearla). La consulta viaja envuelta en un objeto
   * porque el builder de Supabase es "thenable": si la devolviéramos suelta, el
   * `await` la ejecutaría en vez de dejarnos seguir encadenando `.range()`.
   */
  const applyFilters = useCallback(
    (query: FilterableQuery): { query: FilterableQuery } | null => {
      if (!workspaceId) return null;

      // Saneamos el término del usuario antes de interpolarlo en el filtro `.or()`:
      // (1) quitamos los caracteres de la gramática PostgREST `.or()` que NO son
      //     escapables ahí (`,` `(` `)` `:` `*` y `\`), y
      // (2) escapamos los comodines ilike (`%` `_`) con escapeLike para tratarlos
      //     como literales — sin esto, `juan_perez` no matchearía su propio `_`.
      // La query ya está acotada por workspace_id + RLS.
      const rawSearch = search.trim();
      const cleaned = rawSearch ? rawSearch.replace(/[,()\\:*]/g, ' ').trim() : '';
      if (rawSearch && !cleaned) return null;

      // Etiquetas: el filtro viaja al servidor sobre el join (`contact_tags!inner`
      // en el select, ver `tagJoin`) en vez de traerse la lista de ids y
      // reenviarla en un `.in()`. Ese camino traía como mucho 1.000 vínculos
      // —la etiqueta "comprador" tiene 1.555—, así que la lista escondía en
      // silencio a todos los demás. El join además cuenta bien: un contacto con
      // dos de las etiquetas marcadas sigue apareciendo una sola vez.
      if (selectedTagIds.length > 0) {
        query = query.in('contact_tags.tag_id', selectedTagIds);
      }

      // Filtro por fecha de alta: atajo (7/30/90 días) o rango del calendario.
      const bounds = dateChipBounds(datePreset, dateCustom, tz);
      if (bounds.from) query = query.gte('created_at', bounds.from);
      if (bounds.to) query = query.lt('created_at', bounds.to);

      // Filtro por cliente Shopify. Marcar las dos opciones es lo mismo que no
      // marcar ninguna: entran todos.
      if (shopifyFilter.length === 1) {
        query = query.eq('is_shopify_customer', shopifyFilter[0] === 'customers');
      }

      // Filtro por canal de origen: cualquiera de los canales marcados.
      if (channelFilter.length > 0) query = query.in('channel', channelFilter);

      if (cleaned) {
        const term = `%${escapeLike(cleaned)}%`;
        query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
      }

      return { query };
    },
    [workspaceId, selectedTagIds, search, datePreset, dateCustom, tz, shopifyFilter, channelFilter],
  );

  /**
   * Columnas a pedir. Con filtro por etiqueta se suma el join `contact_tags!inner`,
   * que es sobre lo que `applyFilters` aplica el filtro; sin filtro no se pide,
   * para no traer datos que nadie mira.
   */
  const tagJoin = useCallback(
    (cols: string) =>
      selectedTagIds.length > 0 ? `${cols}, contact_tags!inner(tag_id)` : cols,
    [selectedTagIds],
  );

  const fetchContacts = useCallback(async () => {
    // Wait for the workspace to resolve — otherwise without an
    // explicit workspace_id filter, RLS would still surface contacts
    // from every workspace the user belongs to.
    if (!workspaceId) return;
    setLoading(true);

    const from = page * pageSize;
    const to = from + pageSize - 1;

    const base = supabase
      .from('contacts')
      .select(tagJoin('*'), { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    const filtered = applyFilters(base as unknown as FilterableQuery);
    if (!filtered) {
      setContacts([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const { data, count, error } = await (filtered.query as unknown as typeof base).range(from, to);

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

    const rows = data as unknown as Contact[];

    // Etiquetas de los contactos de esta página. Se pagina porque cada contacto
    // tiene varias y 100 contactos pueden pasar de las 1.000 filas que PostgREST
    // devuelve por respuesta — si no, a las últimas filas de la página les
    // faltarían etiquetas sin aviso.
    const contactIds = rows.map((c) => c.id);
    const tagsByContact: Record<string, string[]> = {};
    for (let offset = 0; ; offset += 1000) {
      const { data: contactTags } = await supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', contactIds)
        .order('contact_id', { ascending: true })
        .order('tag_id', { ascending: true })
        .range(offset, offset + 999);
      const links = (contactTags ?? []) as Array<{ contact_id: string; tag_id: string }>;
      links.forEach((ct) => {
        (tagsByContact[ct.contact_id] ??= []).push(ct.tag_id);
      });
      if (links.length < 1000) break;
    }

    const enriched: ContactWithTags[] = rows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [supabase, page, pageSize, tagsMap, applyFilters, tagJoin, workspaceId, t]);

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

  // Al cambiar el filtro se vacía la selección: si no, "exportar" se llevaría
  // contactos que la lista ya no muestra. La paginación no la toca — la
  // selección es a través de páginas a propósito.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(new Set());
  }, [selectedTagIds, datePreset, dateCustom, shopifyFilter, channelFilter, search]);

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

  // Un solo "Limpiar" para todos los filtros: etiquetas incluidas, porque
  // filtran junto a los chips, no aparte.
  const filtersActive =
    selectedTagIds.length > 0 ||
    datePreset !== 'all' ||
    shopifyFilter.length > 0 ||
    channelFilter.length > 0;
  function clearFilters() {
    setSelectedTagIds([]);
    setDatePreset('all');
    setDateCustom(null);
    setShopifyFilter([]);
    setChannelFilter([]);
    setPage(0);
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
  // Mismo filtro que la tabla, sin excepciones: lo que dice el contador es lo
  // que se selecciona.
  async function selectAllMatching() {
    if (!workspaceId) return;
    // PostgREST corta TODA respuesta en 1.000 filas, así que un `.limit(10000)`
    // devolvía 1.000 y "seleccionar los 3.256" marcaba sólo esos. Se pagina
    // hasta agotar el filtro; el builder es de un solo uso, así que la consulta
    // se reconstruye en cada vuelta. El orden explícito (alta + id como
    // desempate) hace que las páginas no se solapen ni se salteen filas.
    const PAGE = 1000;
    const ids: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const base = supabase
        .from('contacts')
        .select(tagJoin('id'))
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      // El cast evita que TS recorra el tipo del `select('id')` columna por
      // columna al compararlo con FilterableQuery (instanciación infinita).
      const filtered = applyFilters(base as unknown as FilterableQuery);
      if (!filtered) break;
      const { data, error } = await (filtered.query as unknown as typeof base).range(
        offset,
        offset + PAGE - 1,
      );
      if (error) {
        toast.error(t('contacts.loadContactsError'));
        break;
      }
      const rows = (data ?? []) as unknown as Array<{ id: string }>;
      ids.push(...rows.map((r) => r.id));
      if (rows.length < PAGE) break;
    }
    setSelectedIds(new Set(ids));
  }

  async function exportCsv(cols: ResolvedColumn[]) {
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
      const tagsByContact = await tagNamesByContact(supabase, ids, tagsMap);
      downloadContactsCsv(rows, tagsByContact, fmt, cols);
      toast.success(t('contacts.exported', { count: rows.length }));
      setExportOpen(false);
    } catch {
      toast.error(t('contacts.exportError'));
    } finally {
      setExporting(false);
    }
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

      {/* Filtros (dropdowns): fecha · Shopify · canal */}
      <div className="flex flex-wrap items-center gap-2">
        <DateAddedFilter
          preset={datePreset}
          custom={dateCustom}
          onChange={(p, c) => {
            setDatePreset(p);
            setDateCustom(c);
            setPage(0);
          }}
        />
        <FilterMultiSelect
          label={t('contacts.filterShopifyLabel')}
          allLabel={t('contacts.filterAnyShopify')}
          values={shopifyFilter}
          onChange={(v) => {
            setShopifyFilter(v);
            setPage(0);
          }}
          options={[
            { value: 'customers', label: t('contacts.shopFilterCustomers') },
            { value: 'non', label: t('contacts.shopFilterNon') },
          ]}
        />
        <FilterMultiSelect
          label={t('contacts.filterChannelLabel')}
          allLabel={t('contacts.filterAnyChannel')}
          values={channelFilter}
          onChange={(v) => {
            setChannelFilter(v);
            setPage(0);
          }}
          options={[
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
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('contacts.clear')}
          </button>
        )}
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
                className={cn(
                  'app-chip-tono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all hover:-translate-y-px',
                  active && 'app-chip-tono-activo',
                )}
                style={{ '--tono': color } as CSSProperties}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {tag.name}
              </button>
            );
          })}
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
                          {t('contacts.storeBadge')}
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
                            className="app-chip-tono inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ '--tono': tag.color } as CSSProperties}
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
                  <TableCell className="text-muted-foreground text-xs hidden lg:table-cell whitespace-nowrap">
                    {fmt.dateTime(contact.created_at, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
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

      {/* Export column picker */}
      <ExportColumnsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        count={selectedIds.size}
        exporting={exporting}
        onExport={exportCsv}
      />

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


