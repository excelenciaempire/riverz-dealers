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
      // Single query a channel_connections + shopify_connections +
      // ai_agents + membresía del workspace. Shopify vive en su propia
      // tabla (no en channel_connections) porque la integración OAuth
      // se montó antes del unified inbox; el checklist las consulta a
      // las dos para que el paso "Conecta Shopify" se marque listo.
      const [
        { data: channels },
        { data: shopify },
        { data: agents },
        { data: membership },
      ] = await Promise.all([
        supabase
          .from('channel_connections')
          .select('channel, status')
          .eq('user_id', user.id),
        supabase
          .from('shopify_connections')
          .select('id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .limit(1),
        supabase
          .from('ai_agents')
          .select('id, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .limit(1),
        supabase
          .from('workspace_members')
          .select('id')
          .eq('user_id', user.id)
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
      const workspace_created = (membership ?? []).length > 0;
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
