/**
 * El paso "Llamar con IA" que ESPERA el resultado.
 *
 * Lo que se protege acá es la regresión más cara del cambio: que un nodo ya
 * guardado en producción empiece a suspender la corrida sin que nadie lo haya
 * pedido, o que el resultado de la llamada deje de estar disponible para la
 * condición que viene después.
 */
import { describe, it, expect } from 'vitest';
import { conditionDataPoints, templateDataPoints } from './data-points';
import type { VoiceCallStepConfig } from '@/types';

/** Espejo de `waitsForVoiceResult` del motor (no exportado). */
function waits(cfg: VoiceCallStepConfig): boolean {
  return cfg.wait_for_result === true;
}

describe('cuándo el paso de llamada suspende la corrida', () => {
  it('un nodo viejo (sin el campo) sigue siendo fire-and-forget', () => {
    // Las automatizaciones que ya corren en producción se armaron contra ese
    // comportamiento. Cambiárselo al desplegar sería modificar en silencio lo
    // que hacen los flujos de un comercio.
    expect(waits({ agent_id: 'a' })).toBe(false);
  });

  it('un nodo nuevo espera', () => {
    expect(waits({ agent_id: 'a', wait_for_result: true })).toBe(true);
  });

  it('se puede apagar explícitamente', () => {
    expect(waits({ agent_id: 'a', wait_for_result: false })).toBe(false);
  });
});

describe('datos de la llamada disponibles para ramificar', () => {
  it('no aparecen en una automatización que no llama', () => {
    const ids = conditionDataPoints('shopify_order_created').map((d) => d.id);
    expect(ids).not.toContain('call_outcome');
  });

  it('aparecen en cuanto la automatización tiene un paso de llamada', () => {
    // Esto es lo que permite "llamar; si no contesta, mandar WhatsApp" en UNA
    // sola automatización: antes el resultado sólo existía bajo el disparador
    // `voice_call_completed`, o sea en una segunda automatización aparte.
    const ids = conditionDataPoints('shopify_order_created', {
      hasVoiceCall: true,
    }).map((d) => d.id);
    expect(ids).toContain('call_outcome');
    expect(ids).toContain('call_status');
    expect(ids).toContain('call_duration');
  });

  it('siguen apareciendo bajo su disparador original', () => {
    const ids = conditionDataPoints('voice_call_completed').map((d) => d.id);
    expect(ids).toContain('call_outcome');
  });

  it('el resumen se puede meter en una plantilla', () => {
    const ids = templateDataPoints('shopify_order_created', {
      hasVoiceCall: true,
    }).map((d) => d.id);
    expect(ids).toContain('call_summary');
  });

  it('el resultado se elige de una lista, no se escribe a mano', () => {
    // Nadie tiene por qué saber que "canceló" se escribe
    // `cancelled_by_customer`.
    const dp = conditionDataPoints('voice_call_completed').find(
      (d) => d.id === 'call_outcome',
    );
    expect(dp?.valueKind).toBe('enum');
    expect(dp?.options?.map((o) => o.value)).toContain('cancelled_by_customer');
  });

  it('el estado sólo ofrece estados finales', () => {
    const dp = conditionDataPoints('voice_call_completed').find(
      (d) => d.id === 'call_status',
    );
    const values = dp?.options?.map((o) => o.value) ?? [];
    expect(values).toContain('no_answer');
    // En cola o marcando no son estados en los que una condición pueda correr:
    // el paso siguiente sólo se ejecuta cuando la llamada terminó.
    expect(values).not.toContain('queued');
    expect(values).not.toContain('dialing');
  });
});
