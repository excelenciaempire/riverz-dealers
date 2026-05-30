'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { MessageTemplate } from '@/types';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

const statusColors: Record<string, string> = {
  Draft: 'bg-muted text-muted-foreground border-border',
  Pending: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  Approved: 'bg-primary/20 text-accent-ink border-primary/30',
  Rejected: 'bg-red-600/20 text-red-400 border-red-600/30',
};

const statusLabels: Record<string, string> = {
  Draft: 'Borrador',
  Pending: 'Pendiente',
  Approved: 'Aprobada',
  Rejected: 'Rechazada',
};

export default function TemplatesPage() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void fetchTemplates(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates(userId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('No se cargaron las plantillas');
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Sincronización fallida');
      toast.success(
        `${data.total} plantilla${data.total === 1 ? '' : 's'} sincronizada${data.total === 1 ? '' : 's'} desde Meta`,
      );
      await fetchTemplates(user.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo sincronizar');
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
      toast.success('Plantilla eliminada');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">Plantillas</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            className="border-border bg-transparent text-foreground hover:bg-accent"
          >
            <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
          <Button
            render={
              <Link href="/templates/new" />
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Nueva plantilla
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-accent-ink" />
        </div>
      ) : templates.length === 0 ? (
        <Card className="bg-card border-border ring-0">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">Aún no hay plantillas.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => (
            <Card key={template.id} className="bg-card border-border ring-0">
              <CardContent className="flex items-start justify-between pt-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-foreground">{template.name}</h3>
                    <Badge
                      className={`border text-xs ${categoryColors[template.category] || ''}`}
                    >
                      {template.category}
                    </Badge>
                    <Badge
                      className={`border text-xs ${statusColors[template.status || 'Draft'] || ''}`}
                    >
                      {statusLabels[template.status || 'Draft']}
                    </Badge>
                    {template.language && (
                      <span className="text-xs uppercase text-muted-foreground">
                        {template.language}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {template.body_text}
                  </p>
                  {template.footer_text && (
                    <p className="text-xs italic text-muted-foreground">
                      {template.footer_text}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(template.id)}
                  className="ml-2 shrink-0 text-muted-foreground hover:bg-red-950/30 hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
