'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Tag } from '@/types';

/**
 * Panel de gestión de etiquetas dentro de Contactos. Antes solo se
 * podían crear inline desde el popover de un contacto o el chat. Ahora
 * el merchant puede auditar su taxonomía completa, renombrar, cambiar
 * color y borrar etiquetas que ya no usa, todo desde un solo lugar.
 *
 * Cada etiqueta muestra el conteo de contactos que la usan, para que
 * borrar no sea a ciegas (saber "esta etiqueta tiene 1247 contactos
 * pegados" ayuda a no romper segmentos).
 */
const PRESET_COLORS = [
  '#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#64748b',
];

interface TagWithCount extends Tag {
  contact_count: number;
}

export function TagsPanel() {
  const supabase = createClient();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TagWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('tags')
      .select('*, contact_tags(count)')
      .order('name');
    if (error) {
      toast.error('No se pudieron cargar las etiquetas');
      setLoading(false);
      return;
    }
    setTags(
      (data ?? []).map((t: { id: string; name: string; color: string; contact_tags?: Array<{ count: number }> }) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        contact_count: t.contact_tags?.[0]?.count ?? 0,
      })) as TagWithCount[],
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error('No se pudo eliminar la etiqueta');
      return;
    }
    toast.success('Etiqueta eliminada');
    setDeleteTarget(null);
    void load();
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Tus etiquetas
          </h2>
          <p className="text-xs text-muted-foreground">
            Sirven para segmentar contactos y mandar campañas a grupos
            específicos.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          size="sm"
        >
          <Plus className="size-4" />
          Nueva etiqueta
        </Button>
      </div>

      {tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <p className="text-sm font-medium text-foreground">
            Todavía no tienes etiquetas
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Empieza creando una. Después la puedes asignar a contactos
            desde la lista o desde el chat.
          </p>
          <Button
            onClick={() => setCreating(true)}
            className="mt-4"
            size="sm"
            variant="outline"
          >
            <Plus className="size-4" />
            Crear etiqueta
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color ?? '#64748b' }}
                  aria-hidden
                />
                <span className="truncate text-sm text-foreground">
                  {tag.name}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {tag.contact_count}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => setEditing(tag)}
                  aria-label="Editar etiqueta"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  onClick={() => setDeleteTarget(tag)}
                  aria-label="Eliminar etiqueta"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <TagFormDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
      {editing && (
        <TagFormDialog
          tag={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              ¿Eliminar la etiqueta &quot;{deleteTarget?.name}&quot;?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget?.contact_count
              ? `Se quitará de los ${deleteTarget.contact_count} contactos que la tienen. Los contactos no se eliminan.`
              : 'Ningún contacto la tiene asignada, así que es seguro borrarla.'}
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TagFormDialog({
  tag,
  onClose,
  onSaved,
}: {
  tag?: Tag;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Ponle un nombre a la etiqueta');
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      toast.error('Sesión expirada');
      return;
    }
    const { data: member } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (tag) {
      const { error } = await supabase
        .from('tags')
        .update({ name: name.trim(), color })
        .eq('id', tag.id);
      setSaving(false);
      if (error) return toast.error('No se pudo guardar');
      toast.success('Etiqueta actualizada');
      onSaved();
    } else {
      const { error } = await supabase.from('tags').insert({
        name: name.trim(),
        color,
        workspace_id: member?.workspace_id,
      });
      setSaving(false);
      if (error) return toast.error('No se pudo crear');
      toast.success('Etiqueta creada');
      onSaved();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tag ? 'Editar etiqueta' : 'Nueva etiqueta'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Nombre</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VIP, Mayorista, Lima…"
              className="mt-1"
              autoFocus
            />
          </label>
          <div>
            <span className="text-xs text-muted-foreground">Color</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-7 rounded-full border-2 transition-transform',
                    color === c
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {tag ? 'Guardar' : 'Crear'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
