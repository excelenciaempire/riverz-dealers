"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact, ContactNote } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  StickyNote,
  Plus,
  Sparkles,
  RefreshCw,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactTags } from "@/components/contacts/contact-tags";
import { ShopifyContactPanel } from "@/components/inbox/shopify-contact-panel";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type ContactSegment = NonNullable<Contact["ai_segment"]>;

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [segment, setSegment] = useState<ContactSegment | null>(null);
  const [recentActivity, setRecentActivity] = useState<string | null>(null);
  const [segLoading, setSegLoading] = useState(false);

  // Pull (and lazily compute) the AI segment for this contact. Shows the
  // cached value instantly from the contact row, then confirms/refreshes
  // from the API. `refresh` forces a recompute.
  const fetchSegment = useCallback(
    async (refresh = false) => {
      if (!contact) return;
      setSegLoading(true);
      try {
        const res = await fetch(
          `/api/contacts/${contact.id}/segment${refresh ? "?refresh=1" : ""}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const j = await res.json();
          setSegment((j.segment as ContactSegment | null) ?? null);
          setRecentActivity((j.recent_activity as string | null) ?? null);
        }
      } catch {
        /* silent — the segment card is secondary */
      } finally {
        setSegLoading(false);
      }
    },
    [contact],
  );

  useEffect(() => {
    setSegment(contact?.ai_segment ?? null);
    setRecentActivity(null);
    if (contact) fetchSegment(false);
  }, [contact, fetchSegment]);

  const fetchNotes = useCallback(async () => {
    if (!contact) return;
    setNotesLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("contact_notes")
      .select("*")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });

    setNotes(data ?? []);
    setNotesLoading(false);
  }, [contact]);

  // Load on contact change. setNotes runs inside an async Supabase
  // callback, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotes();
  }, [fetchNotes]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">Selecciona una conversación</p>
      </div>
    );
  }

  const displayName = contact.name || contact.email || contact.phone || contact.external_id || 'Contacto';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-accent-ink" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Shopify context: si el contacto matchea con un customer
              de Shopify (por email o teléfono), aquí aparece su LTV,
              últimos pedidos y acciones rápidas. Si no hay match,
              el componente no renderiza nada. */}
          <ShopifyContactPanel
            contactEmail={contact.email ?? null}
            contactPhone={contact.phone ?? null}
          />

          {/* Segmento IA — perfil enriquecido estilo CRM (Blueberry). Solo
              aparece cuando la IA ya pudo inferir un segmento real; si el
              contacto no tiene datos suficientes, no mostramos nada (en vez
              de un "Sin datos" que solo ocupa espacio). */}
          {segment && (
            <>
              <div>
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-accent-ink" />
                    Segmento IA
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchSegment(true)}
                    disabled={segLoading}
                    aria-label="Recalcular segmento"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3 w-3", segLoading && "animate-spin")} />
                  </button>
                </div>
                <div className="mt-2">
                  <span className="inline-flex rounded-full border border-accent-ink/30 bg-accent/40 px-2 py-0.5 text-[11px] font-medium text-accent-ink">
                    {segment.label}
                  </span>
                  {segment.traits.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {segment.traits.map((t, i) => (
                        <li
                          key={i}
                          className="flex gap-1.5 text-xs text-foreground"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-ink/50" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}

                  {recentActivity && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Activity className="h-3 w-3" />
                        Actividad reciente
                      </p>
                      <p className="mt-1 line-clamp-3 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-foreground">
                        {recentActivity}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              Etiquetas
            </div>
            <ContactTags contactId={contact.id} className="mt-2" />
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              Notas
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Nota"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  aria-label="Agregar nota"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notesLoading ? (
                  <>
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-4/5" />
                  </>
                ) : (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-lg bg-muted px-3 py-2"
                    >
                      <p className="whitespace-pre-wrap text-xs text-foreground">
                        {note.note_text}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {format(new Date(note.created_at), "d MMM yyyy HH:mm")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
