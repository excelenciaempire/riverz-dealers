'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Estado de onboarding del workspace. El sidebar y el Inicio lo usan
 * para mostrar un chip "Conecta" en Integraciones y un checklist
 * activo en la página de Inicio hasta que el merchant haya cubierto
 * los mínimos para que la app sea útil.
 *
 * Mínimos: WhatsApp Cloud API conectado + Shopify conectado +
 * al menos un agente IA activo. Con eso, los tres primeros casos
 * de uso (inbox unificado, bot que contesta, búsqueda de pedidos)
 * funcionan.
 */
export interface SetupStatus {
  workspace_created: boolean;
  whatsapp_connected: boolean;
  shopify_connected: boolean;
  has_agent: boolean;
  /** Número de pasos completados (sobre el total de pasos). */
  completed: number;
  /** True cuando todos los pasos están completos. El sidebar usa esto
   *  para esconder el chip "Conecta". */
  ready: boolean;
  /** Se está consultando todavía. El UI puede mostrar skeleton. */
  loading: boolean;
}

export function useSetupStatus(): SetupStatus {
  const [status, setStatus] = useState<SetupStatus>({
    workspace_created: false,
    whatsapp_connected: false,
    shopify_connected: false,
    has_agent: false,
    completed: 0,
    ready: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled)
          setStatus((s) => ({ ...s, loading: false }));
        return;
      }
      // channel_connections, ai_agents y (post-055) shopify_connections
      // son todos workspace-scoped. Resolvemos los workspace_ids del user
      // primero y filtramos por ahí.
      const { data: memberships } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id);
      const workspaceIds = (memberships ?? []).map(
        (m: { workspace_id: string }) => m.workspace_id,
      );
      const workspace_created = workspaceIds.length > 0;

      if (!workspace_created) {
        if (!cancelled)
          setStatus({
            workspace_created: false,
            whatsapp_connected: false,
            shopify_connected: false,
            has_agent: false,
            completed: 0,
            ready: false,
            loading: false,
          });
        return;
      }

      const [{ data: channels }, { data: shopify }, { data: agents }] =
        await Promise.all([
          supabase
            .from('channel_connections')
            .select('channel, status')
            .in('workspace_id', workspaceIds),
          supabase
            .from('shopify_connections')
            .select('id')
            .in('workspace_id', workspaceIds)
            .eq('status', 'active')
            .limit(1),
          supabase
            .from('ai_agents')
            .select('id')
            .in('workspace_id', workspaceIds)
            .eq('is_active', true)
            .limit(1),
        ]);
      const channelList = (channels ?? []) as Array<{
        channel: string;
        status: string;
      }>;
      const whatsapp_connected = channelList.some(
        (c) => c.channel === 'whatsapp' && c.status === 'connected',
      );
      const shopify_connected =
        (shopify ?? []).length > 0 ||
        channelList.some(
          (c) => c.channel === 'shopify' && c.status === 'connected',
        );
      const has_agent = (agents ?? []).length > 0;
      const flags = [
        workspace_created,
        whatsapp_connected,
        shopify_connected,
        has_agent,
      ];
      const completed = flags.filter(Boolean).length;
      if (!cancelled) {
        setStatus({
          workspace_created,
          whatsapp_connected,
          shopify_connected,
          has_agent,
          completed,
          ready: completed === flags.length,
          loading: false,
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
