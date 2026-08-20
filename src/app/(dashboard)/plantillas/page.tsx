'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Trash2, BarChart3, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { toShortId } from '@/lib/short-id';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/hooks/use-locale';
import { useRecordado } from '@/hooks/use-recordado';
import { useFormat } from '@/hooks/use-format';
import type { TFn } from '@/lib/i18n/translate';
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
import { cn } from '@/lib/utils';
import type { MessageTemplate } from '@/types';

// Maps a DB category / status value to its i18n key. Resolved with t() at
// render time so the visible label follows the active UI language.
const CATEGORY_KEYS: Record<string, string> = {
  Marketing: 'templates.categoryMarketing',
  Utility: 'templates.categoryUtility',
  Authentication: 'templates.categoryAuthentication',
};

const STATUS_KEYS: Record<string, string> = {
  Draft: 'templates.statusDraft',
  Pending: 'templates.statusPending',
  Approved: 'templates.statusApproved',
  Rejected: 'templates.statusRejected',
};

/**
 * Status pill — only color the states the merchant needs to react to:
 * Approved (verde sutil) and Rejected (rojo sutil). Borrador y Pendiente
 * quedan neutros para reducir ruido cromático.
 */
function StatusPill({ status, t }: { status: string; t: TFn }) {
  const tone =
    status === 'Approved'
      ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
      : status === 'Rejected'
        ? 'border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-300'
        : status === 'Pending'
          ? 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tone,
      )}
    >
      {STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status}
    </span>
  );
}

/**
 * Insignia de calidad / pausa. Solo aparece cuando hay algo que el comercio
 * debe notar: plantilla PAUSADA por Meta, calidad media/baja, o UNKNOWN en una
 * aprobada (nueva sin historial → WhatsApp puede retenerla por pacing). GREEN
 * no muestra nada (reduce ruido).
 */
function QualityPill({ template, t }: { template: MessageTemplate; t: TFn }) {
  const paused = (template.meta_status ?? '').toUpperCase() === 'PAUSED';
  const q = (template.quality_score ?? '').toUpperCase();
  const base =
    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium';
  if (paused) {
    return (
      <span className={cn(base, 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
        {t('templates.paused')}
      </span>
    );
  }
  if (q === 'RED') {
    return (
      <span className={cn(base, 'border-red-600/30 bg-red-500/10 text-red-600 dark:text-red-300')}>
        {t('templates.qualityRed')}
      </span>
    );
  }
  if (q === 'YELLOW') {
    return (
      <span className={cn(base, 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
        {t('templates.qualityYellow')}
      </span>
    );
  }
  if (q === 'UNKNOWN' && template.status === 'Approved') {
    return (
      <span
        title={t('templates.pacingHint')}
        className={cn(base, 'border-border bg-muted text-muted-foreground')}
      >
        {t('templates.qualityUnknown')}
      </span>
    );
  }
  return null;
}

export default function TemplatesPage() {
  const supabase = createClient();
  const router = useLocalizedRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const { user, loading: authLoading } = useAuth();
  const t = useT();
  const fmt = useFormat();

  // La sección se acuerda de lo último que mostró: volver es instantáneo y la
  // consulta sale igual, en silencio, para reemplazarlo.
  const [templates, setTemplates, habia] = useRecordado<MessageTemplate[]>(
    'plantillas',
    [],
  );
  const [loading, setLoading] = useState(!habia);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void (async () => {
      // Mostramos lo que hay al instante y sincronizamos con Meta en segundo
      // plano (silencioso) para que el catálogo esté siempre fresco sin que el
      // usuario tenga que apretar "Sincronizar".
      await fetchTemplates(user.id);
      void autoSync(user.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  // Auto-sync al entrar, con throttle: evita golpear la API de Meta si el
  // usuario navega dentro/fuera de Plantillas varias veces seguidas.
  async function autoSync(userId: string) {
    try {
      const KEY = 'templatesAutoSyncAt';
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < 30_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
      const res = await fetchWithCsrf('/api/whatsapp/templates/sync', {
        method: 'POST',
      });
      if (!res.ok) return; // silencioso: si Meta falla, dejamos el catálogo local
      await fetchTemplates(userId);
    } catch {
      // Silencioso: el auto-sync es una mejora, no debe molestar con errores.
    }
  }

  async function fetchTemplates(userId: string) {
    try {
      // Sin `setLoading(true)` acá: si la sección se acordaba del catálogo, ya
      // está en pantalla, y encender el esqueleto lo taparía para volver a
      // mostrar lo mismo. La primera vez el estado ya arranca en `true`.
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error(t('templates.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetchWithCsrf('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t('templates.syncFailedDefault'));
      toast.success(
        t(
          data.total === 1
            ? 'templates.syncedFromMetaSingular'
            : 'templates.syncedFromMetaPlural',
          { count: data.total },
        ),
      );
      await fetchTemplates(user.id);
    } catch (err) {
      toast.error(t('templates.syncCouldNot'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success(t('templates.templateDeleted'));
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    } catch (err) {
      toast.error(t('templates.deleteFailed'));
    }
  }

  const rows = templates;
  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (tpl) =>
        tpl.name.toLowerCase().includes(q) ||
        (tpl.body_text ?? '').toLowerCase().includes(q) ||
        (tpl.category ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="space-y-5">
      {/* ── Header + actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t('templates.whatsappTemplates')}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            className="h-9 border-border bg-transparent text-foreground hover:bg-muted"
          >
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? t('templates.syncing') : t('templates.sync')}
          </Button>
          <Button
            render={<Link href="/plantillas/nueva" />}
            className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t('templates.newTemplate')}
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 py-16 text-center">
          <p className="text-sm font-medium text-foreground">{t('templates.emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('templates.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('templates.searchPlaceholder')}
              className="h-9 pl-8"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-xs font-medium text-muted-foreground">
                  {t('templates.columnName')}
                </TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">
                  {t('templates.columnCategory')}
                </TableHead>
                <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                  {t('templates.columnMessage')}
                </TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">
                  {t('templates.columnStatus')}
                </TableHead>
                <TableHead className="hidden text-xs font-medium text-muted-foreground sm:table-cell">
                  {t('templates.columnUpdated')}
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {t('templates.noMatches', { query })}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((template) => {
                  return (
                    <TableRow
                      key={template.id}
                      className="cursor-pointer border-border hover:bg-muted/40"
                      onClick={() => router.push(`/plantillas/${toShortId(template.id)}`)}
                    >
                      <TableCell className="font-medium text-foreground">
                        {template.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {CATEGORY_KEYS[template.category]
                          ? t(CATEGORY_KEYS[template.category])
                          : template.category}
                      </TableCell>
                      <TableCell className="hidden max-w-[420px] truncate text-sm text-muted-foreground md:table-cell">
                        {template.body_text}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={template.status || 'Draft'} t={t} />
                          <QualityPill template={template} t={t} />
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground sm:table-cell">
                        {fmt.date(template.created_at, { day: '2-digit', month: 'short' })}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            router.push(`/plantillas/${toShortId(template.id)}`)
                          }
                          className="text-accent-ink hover:text-accent-ink"
                        >
                          <BarChart3 className="size-3.5" />
                          <span className="hidden sm:inline">
                            {t('templates.viewStats')}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(template.id)}
                          className="min-h-10 min-w-10 sm:h-8 sm:w-8 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                          aria-label={t('templates.deleteTemplateAria')}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      )}
    </div>
  );
}

