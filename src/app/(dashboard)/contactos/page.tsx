'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
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
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { SegmentsPanel } from '@/components/contacts/segments-panel';
import { TagsPanel } from '@/components/contacts/tags-panel';
import { useWorkspace } from '@/hooks/use-workspace';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const supabase = createClient();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? null;

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

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

  const fetchContacts = useCallback(async () => {
    // Wait for the workspace to resolve — otherwise without an
    // explicit workspace_id filter, RLS would still surface contacts
    // from every workspace the user belongs to.
    if (!workspaceId) return;
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

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

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    const { data, count, error } = await query;

    if (error) {
      toast.error('No se cargaron los contactos');
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
  }, [supabase, page, search, tagsMap, selectedTagIds, workspaceId]);

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
      toast.error('No se pudo eliminar el contacto');
    } else {
      toast.success('Contacto eliminado');
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contactos</h1>
          {totalCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {totalCount} en total
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
              Importar
            </Button>
            <Button
              onClick={openAddForm}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="size-4" />
              Añadir contacto
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
          Contactos
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
          Etiquetas
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
          Segmentos
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
          placeholder="Nombre, teléfono o correo"
          className="pl-8 bg-muted border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Tag filter */}
      {Object.keys(tagsMap).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.values(tagsMap).map((tag) => {
            const active = selectedTagIds.includes(tag.id);
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
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                  active ? '' : 'opacity-60 hover:opacity-100',
                )}
                style={{
                  backgroundColor: active ? `${tag.color}20` : 'transparent',
                  color: tag.color,
                  borderColor: `${tag.color}66`,
                }}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
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
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Nombre</TableHead>
              <TableHead className="text-muted-foreground">Teléfono</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">Correo</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">Empresa</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">Etiquetas</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">Creado</TableHead>
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
                        Sin resultados.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Users className="size-8 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Aún no tienes contactos
                        </p>
                        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                          Agrega tu primer contacto para empezar a chatear y
                          armar campañas.
                        </p>
                      </div>
                      <Button
                        onClick={openAddForm}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <Plus className="size-4" />
                        Añadir tu primer contacto
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
                  <TableCell className="text-foreground font-medium">
                    <div className="flex items-center gap-2">
                      <span>
                        {contact.name || <span className="text-muted-foreground italic">Sin nombre</span>}
                      </span>
                      {contact.is_shopify_customer && (
                        <span
                          aria-label="Cliente Shopify"
                          title="Cliente Shopify"
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
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-muted-foreground">-</span>}
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
                    {new Date(contact.created_at).toLocaleDateString('es-ES', {
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
                          Editar
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
                          Eliminar
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Mostrando {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} de{' '}
            {totalCount}
          </p>
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
              Página {page + 1} de {totalPages}
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

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              ¿Eliminar a{' '}
              <span className="font-medium">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ?
            </DialogTitle>
          </DialogHeader>
          <DialogFooter className="bg-card border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-foreground hover:bg-accent"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
