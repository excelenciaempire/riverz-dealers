'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Cualquier canal conectado (WhatsApp, Instagram o Facebook). El stepper
   *  de onboarding lo usa para marcar el paso "Conecta un canal". */
  any_channel_connected: boolean;
  shopify_connected: boolean;
  /** Tiene al menos un producto (shopify_products, sincronizado o manual). */
  has_product: boolean;
  has_agent: boolean;
  /** Número de pasos completados (sobre el total de pasos). */
  completed: number;
  /** True cuando todos los pasos están completos. El sidebar usa esto
   *  para esconder el chip "Conecta". */
  ready: boolean;
  /** Se está consultando todavía. El UI puede mostrar skeleton. */
  loading: boolean;
  /** Vuelve a consultar el estado de onboarding. Útil cuando el merchant
   *  acaba de conectar un canal y quiere ver el avance sin recargar. */
  refresh: () => void;
}

export function useSetupStatus(): SetupStatus {
  const [status, setStatus] = useState<
    Omit<SetupStatus, 'refresh'>
  >({
    workspace_created: false,
    whatsapp_connected: false,
    any_channel_connected: false,
    shopify_connected: false,
    has_product: false,
    has_agent: false,
    completed: 0,
    ready: false,
    loading: true,
  });

  // Guard contra respuestas que llegan tras un nuevo refresh: solo la última
  // consulta puede escribir el estado.
  const epochRef = useRef(0);

  const load = useCallback(async () => {
    const epoch = ++epochRef.current;
    const fresh = () => epoch === epochRef.current;
    // No volvemos a `loading: true` en refrescos: el primer mount ya arranca
    // en loading, y un refresh manual debe actualizar el estado sin parpadeo.
    {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (fresh())
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
        if (fresh())
          setStatus({
            workspace_created: false,
            whatsapp_connected: false,
            any_channel_connected: false,
            shopify_connected: false,
            has_product: false,
            has_agent: false,
            completed: 0,
            ready: false,
            loading: false,
          });
        return;
      }

      const [
        { data: channels },
        { data: shopify },
        { data: products },
        { data: agents },
      ] = await Promise.all([
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
          .from('shopify_products')
          .select('id')
          .in('workspace_id', workspaceIds)
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
      // Cualquier canal de mensajería conectado: WhatsApp, Instagram o
      // Facebook. Shopify es una integración de catálogo, no un canal.
      const any_channel_connected = channelList.some(
        (c) =>
          c.status === 'connected' &&
          (c.channel === 'whatsapp' ||
            c.channel === 'instagram' ||
            c.channel === 'facebook'),
      );
      const shopify_connected =
        (shopify ?? []).length > 0 ||
        channelList.some(
          (c) => c.channel === 'shopify' && c.status === 'connected',
        );
      const has_product = (products ?? []).length > 0;
      const has_agent = (agents ?? []).length > 0;
      // Pasos operativos: un canal conectado (cualquiera) + un producto +
      // un asistente activo. Shopify es opcional y WhatsApp no es obligatorio,
      // así que `ready` (chip "Conecta" del sidebar) refleja este camino real.
      const flags = [any_channel_connected, has_product, has_agent];
      const completed = flags.filter(Boolean).length;
      if (fresh()) {
        setStatus({
          workspace_created,
          whatsapp_connected,
          any_channel_connected,
          shopify_connected,
          has_product,
          has_agent,
          completed,
          ready: completed === flags.length,
          loading: false,
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...status, refresh: load };
}
