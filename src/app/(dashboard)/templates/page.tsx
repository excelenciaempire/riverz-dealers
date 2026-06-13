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
        <h1 className="text-2xl font-bold text-foreground">Plantillas de WhatsApp</h1>
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
      ) : (
        <>
          {templates.length === 0 && (
            <p className="-mb-1 text-[11px] italic text-muted-foreground">
              Vista previa con datos de ejemplo. Cuando creés tu primera plantilla, esta lista se reemplaza con tus datos reales.
            </p>
          )}
          <div
            className={`grid gap-3 ${templates.length === 0 ? 'opacity-60' : ''}`}
          >
            {(templates.length === 0 ? PLACEHOLDER_TEMPLATES : templates).map((template) => {
              const isPlaceholder = template.id.startsWith('demo-');
              return (
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
                      onClick={() => !isPlaceholder && handleDelete(template.id)}
                      disabled={isPlaceholder}
                      className="ml-2 shrink-0 text-muted-foreground hover:bg-red-950/30 hover:text-red-400 disabled:cursor-default disabled:opacity-40"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Placeholder data — shown while the merchant doesn't have any real
// templates yet so the list reads as populated and they can see how
// each category / status badge renders. Rows have id "demo-*" so
// the delete handler short-circuits.
// ============================================================
const PLACEHOLDER_TEMPLATES: MessageTemplate[] = [
  {
    id: 'demo-1',
    user_id: 'demo',
    name: 'bienvenida_nuevo_cliente',
    category: 'Utility',
    language: 'es',
    header_type: 'text',
    header_content: '¡Bienvenido a Vitalú!',
    body_text:
      'Hola {{1}} 👋, gracias por unirte a Vitalú. Soy María, tu asesora. ¿En qué te puedo ayudar hoy?',
    footer_text: 'Equipo Vitalú',
    buttons: undefined,
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-2',
    user_id: 'demo',
    name: 'confirmacion_pedido',
    category: 'Utility',
    language: 'es',
    body_text:
      '¡Listo {{1}}! Tu pedido *{{2}}* fue confirmado por {{3}}. Te avisamos cuando salga del centro de despacho. 📦',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-3',
    user_id: 'demo',
    name: 'despacho_con_tracking',
    category: 'Utility',
    language: 'es',
    body_text:
      '🚚 ¡Tu pedido {{1}} ya está en camino! Lo lleva {{2}} con la guía {{3}}. Seguilo con el botón de abajo.',
    footer_text: 'Llega entre 2 y 5 días hábiles.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-4',
    user_id: 'demo',
    name: 'carrito_abandonado_24h',
    category: 'Marketing',
    language: 'es',
    header_type: 'text',
    header_content: '¿Lo dejaste pendiente?',
    body_text:
      'Hola {{1}}, ayer dejaste {{2}} en el carrito. Te dejamos un 10% con el código *VUELVE10* — vale por 24 horas. 💚',
    footer_text: 'Sin presión, vos sabés cuándo es el momento.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-5',
    user_id: 'demo',
    name: 'recompra_30dias',
    category: 'Marketing',
    language: 'es',
    body_text:
      'Hola {{1}}, hace un mes pediste {{2}}. ¿Cómo te fue? Si necesitás reponer, te dejamos envío gratis con *FIDELIDAD*. 🌿',
    status: 'Pending',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-6',
    user_id: 'demo',
    name: 'codigo_verificacion_otp',
    category: 'Authentication',
    language: 'es',
    body_text:
      'Tu código de verificación de Vitalú es {{1}}. Vence en 10 minutos. No lo compartas con nadie.',
    footer_text: 'Si no fuiste vos, ignorá este mensaje.',
    status: 'Draft',
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-7',
    user_id: 'demo',
    name: 'aviso_stock_agotado',
    category: 'Utility',
    language: 'es',
    body_text:
      'Hola {{1}}, lamentablemente *{{2}}* se agotó antes de despacharlo. Te devolvemos el dinero a {{3}} en 24-48 hs. Disculpá la molestia. 🙏',
    status: 'Rejected',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
  } as unknown as MessageTemplate,
];
