'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, ContactNote } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ContactTags } from '@/components/contacts/contact-tags';
import { ContactActivityTimeline } from '@/components/contacts/contact-activity-timeline';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import type { TFn } from '@/lib/i18n/translate';
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  Tag,
} from 'lucide-react';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const supabase = createClient();
  const t = useT();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone);
      setEditEmail(data.email ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  /**
   * Pide a Shopify lo que falte de este cliente (dirección, pedidos, gasto) al
   * abrir la ficha. Antes esto sólo pasaba cuando el agente de IA atendía un
   * mensaje, así que la dirección no aparecía nunca. Silencioso y sin bloquear:
   * si Shopify no contesta o la persona no es cliente, la ficha se ve igual con
   * el resto de los datos.
   */
  const enrichFromShopify = useCallback(async () => {
    if (!contactId) return;
    setEnriching(true);
    try {
      const res = await fetchWithCsrf(`/api/contacts/${contactId}/enrich`, {
        method: 'POST',
      });
      const payload = (await res.json().catch(() => null)) as { data?: unknown } | null;
      // Sólo relee si Shopify devolvió algo nuevo que mostrar.
      if (res.ok && payload?.data) fetchContact();
    } catch {
      /* la ficha ya está mostrando todo lo demás */
    } finally {
      setEnriching(false);
    }
  }, [contactId, fetchContact, fetchWithCsrf]);

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchNotes();
      void enrichFromShopify();
    }
  }, [open, contactId, fetchContact, fetchNotes, enrichFromShopify]);

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('contacts.missingPhone'));
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error(t('contacts.updateContactError'));
    } else {
      toast.success(t('contacts.contactUpdated'));
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error(t('contacts.notAuthenticated'));
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error(t('contacts.addNoteError'));
    } else {
      setNewNote('');
      fetchNotes();
      toast.success(t('contacts.noteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error(t('contacts.deleteNoteError'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('contacts.noteDeleted'));
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-card border-border text-foreground sm:max-w-lg w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-accent-ink" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-muted border border-border">
                  <AvatarFallback className="bg-primary/10 text-accent-ink text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-foreground truncate">
                    {contact.name || t('contacts.unknown')}
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    {contact.name || contact.phone}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-muted/50 border-b border-border mx-4 mt-3">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
                >
                  {t('contacts.detailDetails')}
                </TabsTrigger>
                <TabsTrigger
                  value="activity"
                  className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
                >
                  {t('contacts.tabActivity')}
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
                >
                  {t('contacts.tabTags')}
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-accent data-active:text-accent-ink text-muted-foreground"
                >
                  {t('contacts.detailNotes')}
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  {(contact.last_offer_chosen || contact.last_offer_units) && (
                    <div className="space-y-1 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-accent-ink">
                        <Tag className="size-3.5" />
                        {t('contacts.lastOfferTitle')}
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {[
                          contact.last_offer_chosen || t('contacts.lastOfferNoLabel'),
                          contact.last_offer_units
                            ? t('contacts.lastOfferUnits', {
                                n: contact.last_offer_units,
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {contact.last_offer_at && (
                        <p className="text-xs text-muted-foreground">
                          {fmt.date(contact.last_offer_at, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </div>
                  )}
                  {renderShopifyData(contact, t) ??
                    (enriching ? (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        {t('contacts.shopLoading')}
                      </p>
                    ) : null)}
                  {renderContactInfo(contact, t, fmt)}
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('contacts.fieldName')}</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('contacts.fieldPhone')} <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('contacts.fieldEmail')}</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {t('contacts.save')}
                  </Button>
                </div>
              </TabsContent>

              {/* Activity Tab */}
              <TabsContent
                value="activity"
                className="flex-1 flex flex-col min-h-0 px-4 py-3"
              >
                {contact && <ContactActivityTimeline contact={contact} />}
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                {contactId && (
                  <ContactTags contactId={contactId} onChanged={onUpdated} />
                )}
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={t('contacts.notePlaceholder')}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    {t('contacts.addNote')}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {t('contacts.noNotes')}
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg bg-muted/50 border border-border/50 p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-foreground whitespace-pre-wrap flex-1">
                            {note.note_text}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {fmt.dateTime(note.created_at, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Muestra la dirección y toda la data que sincroniza Shopify (total gastado,
 * pedidos, dirección completa) como una tarjeta de solo lectura. La data vive en
 * `contacts.shopify_customer_data` (jsonb snapshot). No repite email/teléfono
 * (ya están en el formulario). Devuelve null si no hay data de Shopify.
 */
function renderShopifyData(contact: Contact, t: TFn) {
  const sd = (contact as unknown as { shopify_customer_data?: Record<string, unknown> | null })
    .shopify_customer_data;
  if (!sd) return null;
  const addr = (sd.default_address ?? sd.address) as Record<string, unknown> | null;
  const rows: Array<[string, string]> = [];
  const push = (label: string, v: unknown) => {
    if (v != null && String(v).trim() !== '') rows.push([label, String(v)]);
  };
  push(t('contacts.shopTotalSpent'), sd.total_spent ?? sd.totalSpent);
  push(t('contacts.shopOrders'), sd.orders_count ?? sd.ordersCount);
  if (addr) {
    push(t('contacts.shopAddress'), [addr.address1, addr.address2].filter(Boolean).join(' '));
    push(t('contacts.shopCity'), addr.city);
    push(t('contacts.shopProvince'), addr.province);
    push(t('contacts.shopCountry'), addr.country);
    push(t('contacts.shopZip'), addr.zip);
  }
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Shopify</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([label, val]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground break-words">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Datos de solo lectura del contacto (canal de origen, alta, última actividad)
 * para que al abrir el contacto se vea TODA la información de un vistazo, sin
 * duplicar los campos editables (nombre/teléfono/email/empresa).
 */
function renderContactInfo(
  contact: Contact,
  t: TFn,
  fmt: { date: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => string },
) {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const rows: Array<[string, string]> = [];
  const ch = (contact as unknown as { channel?: string | null }).channel;
  if (ch) rows.push([t('contacts.infoChannel'), ch]);
  if (contact.created_at) rows.push([t('contacts.infoCreated'), fmt.date(contact.created_at, opts)]);
  const lastIn = (contact as unknown as { last_inbound_at?: string | null }).last_inbound_at;
  if (lastIn) rows.push([t('contacts.infoLastActivity'), fmt.date(lastIn, opts)]);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([label, val]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground break-words">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
