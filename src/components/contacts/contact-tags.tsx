'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Plus, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Tag } from '@/types';

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

interface ContactTagsProps {
  contactId: string;
  /** Notifies the parent when assignments change (so lists can refresh). */
  onChanged?: () => void;
  className?: string;
}

/**
 * Etiquetas de un contacto: asigna, quita y crea etiquetas en línea.
 * Las etiquetas son del workspace (RLS por workspace_id). Se usa tanto
 * en el detalle de Contactos como en el panel del chat.
 */
export function ContactTags({ contactId, onChanged, className }: ContactTagsProps) {
  const supabase = createClient();
  const { workspace } = useWorkspace();
  const t = useT();

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[5]);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    const [tagsRes, linksRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);
    if (tagsRes.data) setAllTags(tagsRes.data);
    if (linksRes.data) setSelectedIds(linksRes.data.map((l) => l.tag_id));
  }, [supabase, contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const toggle = useCallback(
    async (tagId: string) => {
      setBusyId(tagId);
      const isSelected = selectedIds.includes(tagId);
      if (isSelected) {
        const { error } = await supabase
          .from('contact_tags')
          .delete()
          .eq('contact_id', contactId)
          .eq('tag_id', tagId);
        if (error) {
          toast.error(t('contacts.removeTagError'));
        } else {
          setSelectedIds((prev) => prev.filter((id) => id !== tagId));
          onChanged?.();
        }
      } else {
        const { error } = await supabase
          .from('contact_tags')
          .insert({ contact_id: contactId, tag_id: tagId });
        if (error) {
          toast.error(t('contacts.assignTagError'));
        } else {
          setSelectedIds((prev) => [...prev, tagId]);
          onChanged?.();
        }
      }
      setBusyId(null);
    },
    [supabase, contactId, selectedIds, onChanged, t],
  );

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) {
      toast.error(t('contacts.missingName'));
      return;
    }
    if (!workspace) {
      toast.error(t('contacts.workspaceNotIdentified'));
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('tags')
      .insert({ workspace_id: workspace.id, name, color: newColor })
      .select()
      .single();

    if (error || !data) {
      toast.error(t('contacts.createTagError'));
      setSaving(false);
      return;
    }

    const { error: linkError } = await supabase
      .from('contact_tags')
      .insert({ contact_id: contactId, tag_id: data.id });

    setAllTags((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    if (!linkError) {
      setSelectedIds((prev) => [...prev, data.id]);
      onChanged?.();
    }
    setNewName('');
    setNewColor(PRESET_COLORS[5]);
    setCreating(false);
    setSaving(false);
  }

  const selectedTags = allTags.filter((t) => selectedIds.includes(t.id));

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {selectedTags.map((tag) => (
        <span
          key={tag.id}
          className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
        >
          {tag.name}
          <button
            type="button"
            onClick={() => toggle(tag.id)}
            disabled={busyId === tag.id}
            className="-mr-1 rounded-full p-1.5 opacity-60 transition-opacity hover:opacity-100"
            aria-label={t('contacts.removeTag', { name: tag.name })}
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}

      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setCreating(false);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            />
          }
        >
          <Plus className="size-3" />
          {t('contacts.tagButton')}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 bg-card border-border p-1.5">
          {creating ? (
            <div className="space-y-2 p-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('contacts.namePlaceholder')}
                className="h-8 bg-muted border-border text-foreground text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createAndAssign();
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className="size-6 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: newColor === c ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                    }}
                    aria-label={t('contacts.colorLabel', { color: c })}
                  />
                ))}
              </div>
              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('contacts.cancel')}
                </button>
                <button
                  type="button"
                  onClick={createAndAssign}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-3 animate-spin" />}
                  {t('contacts.create')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="max-h-48 overflow-y-auto">
                {allTags.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {t('contacts.noTagsYet')}
                  </p>
                ) : (
                  allTags.map((tag) => {
                    const selected = selectedIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggle(tag.id)}
                        disabled={busyId === tag.id}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {selected && <Check className="size-3.5 text-accent-ink" />}
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
                {t('contacts.newTag')}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
