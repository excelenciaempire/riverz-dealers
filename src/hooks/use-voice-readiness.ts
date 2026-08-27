'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceBlockerCode } from '@/lib/voice/labels';

export interface VoiceBlockerView {
  code: VoiceBlockerCode;
  fixHref: string | null;
  agentName?: string;
}

export interface VoiceReadinessView {
  ready: boolean;
  blockers: VoiceBlockerView[];
  warnings: VoiceBlockerView[];
  phoneNumber: string | null;
  agents: { id: string; name: string }[];
  firstCallDone: boolean;
}

/**
 * «¿Puede llamar?», para el navegador.
 *
 * Cinco pantallas hacían esta pregunta y ninguna de la misma forma: la de
 * Llamadas consultaba Supabase directo, la pestaña de voz del agente pedía
 * readiness pero sólo le sacaba el número y tiraba los bloqueos, el nodo del
 * lienzo se pintaba su propio cartel y el botón de la bandeja no preguntaba
 * nada y fallaba con un motivo crudo en un toast.
 *
 * Con `agentId` la respuesta es sobre ESE agente (lo que necesita el lienzo y
 * la pestaña del editor); sin él, sobre la cuenta.
 */
export function useVoiceReadiness(
  workspaceId: string | undefined,
  agentId?: string | null,
) {
  const [data, setData] = useState<VoiceReadinessView | null>(null);
  const [loading, setLoading] = useState(true);
  // Descarta respuestas de una consulta vieja: al cambiar de agente rápido, la
  // anterior podía llegar después y dejar el cartel del agente equivocado.
  const epoch = useRef(0);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    const mine = ++epoch.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ workspace_id: workspaceId });
      if (agentId) qs.set('agent_id', agentId);
      const res = await fetch(`/api/voice/readiness?${qs}`, { cache: 'no-store' });
      if (!res.ok || mine !== epoch.current) return;
      const json = (await res.json()) as {
        ready: boolean;
        blockers: VoiceBlockerView[];
        warnings?: VoiceBlockerView[];
        phone_number: string | null;
        agents?: { id: string; name: string }[];
        first_call_done?: boolean;
      };
      if (mine !== epoch.current) return;
      setData({
        ready: json.ready,
        blockers: json.blockers ?? [],
        warnings: json.warnings ?? [],
        phoneNumber: json.phone_number,
        agents: json.agents ?? [],
        firstCallDone: Boolean(json.first_call_done),
      });
    } catch {
      /* sin respuesta se deja lo anterior: un cartel que parpadea a «no puede
         llamar» ante un corte de red miente más que no decir nada */
    } finally {
      if (mine === epoch.current) setLoading(false);
    }
  }, [workspaceId, agentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { readiness: data, loading, reload };
}
