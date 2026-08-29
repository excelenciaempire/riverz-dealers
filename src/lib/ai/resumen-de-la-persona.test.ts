import { describe, it, expect } from 'vitest';
import { resumenDeLaPersona } from './runner';
import type { Conversation } from '@/types';

/**
 * El resumen que ve el agente es de la PERSONA, no del hilo.
 *
 * Los mensajes recientes ya se mezclaban entre canales. El resumen rodante no:
 * era el de la conversación en curso y nada más. Eso se nota justo cuando más
 * importa — alguien que venía hablando en el chat de la web y sigue por
 * WhatsApp arrastra los últimos turnos y pierde todo lo anterior, que es lo
 * que evita preguntarle dos veces lo mismo.
 */

function baseFalsa(filas: { id: string; channel: string; ai_summary: string | null }[]) {
  let pedidos: string[] = [];
  const api = {
    from() {
      return api;
    },
    select() {
      return api;
    },
    in(_k: string, v: string[]) {
      pedidos = v;
      return api;
    },
    not() {
      return api;
    },
    order() {
      return api;
    },
    limit(n: number) {
      return Promise.resolve({
        data: filas.filter((f) => pedidos.includes(f.id) && f.ai_summary).slice(0, n),
        error: null,
      });
    },
  };
  return api as never;
}

const conv = (extra: Partial<Conversation> = {}) =>
  ({ id: 'wa', channel: 'whatsapp', ai_summary: null, ...extra }) as Conversation;

describe('resumenDeLaPersona', () => {
  it('sin hilos hermanos devuelve el propio, tal cual', async () => {
    const r = await resumenDeLaPersona(baseFalsa([]), conv({ ai_summary: 'Pidió dos frascos.' }), [
      'wa',
    ]);
    expect(r).toBe('Pidió dos frascos.');
  });

  it('suma el resumen del otro canal, diciendo de qué canal es', async () => {
    const r = await resumenDeLaPersona(
      baseFalsa([{ id: 'web', channel: 'webchat', ai_summary: 'Preguntó por envíos a Córdoba.' }]),
      conv({ ai_summary: 'Consultó el estado del pedido.' }),
      ['wa', 'web'],
    );
    expect(r).toContain('Consultó el estado del pedido.');
    expect(r).toContain('Preguntó por envíos a Córdoba.');
    // El canal al frente: sin eso el modelo lee lo de otro lado como si se
    // hubiera dicho acá, y contesta "como te decía" sobre algo que no dijo.
    expect(r).toContain('[chat de la web]');
  });

  it('el hilo en curso puede no tener resumen y el del otro canal igual llega', async () => {
    // El caso del traspaso: la conversación de WhatsApp recién empieza, así que
    // no tiene resumen propio. Todo lo que se sabe de la persona está del otro
    // lado.
    const r = await resumenDeLaPersona(
      baseFalsa([{ id: 'web', channel: 'webchat', ai_summary: 'Quiere el serum para el cuello.' }]),
      conv(),
      ['wa', 'web'],
    );
    expect(r).toContain('Quiere el serum para el cuello.');
  });

  it('sin nada que resumir no inventa un resumen vacío', async () => {
    const r = await resumenDeLaPersona(
      baseFalsa([{ id: 'web', channel: 'webchat', ai_summary: null }]),
      conv(),
      ['wa', 'web'],
    );
    expect(r).toBeNull();
  });

  it('acotado: esto va en el prompt de CADA respuesta', async () => {
    const largo = 'x'.repeat(900);
    const r = await resumenDeLaPersona(
      baseFalsa([
        { id: 'a', channel: 'instagram', ai_summary: largo },
        { id: 'b', channel: 'webchat', ai_summary: largo },
        { id: 'c', channel: 'voice', ai_summary: largo },
      ]),
      conv({ ai_summary: largo }),
      ['wa', 'a', 'b', 'c'],
    );
    expect((r ?? '').length).toBeLessThanOrEqual(1800);
  });

  it('un fallo leyendo los hermanos no deja al agente sin su propio resumen', async () => {
    const rota = {
      from() {
        return rota;
      },
      select() {
        return rota;
      },
      in() {
        return rota;
      },
      not() {
        return rota;
      },
      order() {
        return rota;
      },
      limit() {
        return Promise.reject(new Error('se cayó'));
      },
    } as never;
    const r = await resumenDeLaPersona(rota, conv({ ai_summary: 'Lo suyo.' }), ['wa', 'web']);
    expect(r).toBe('Lo suyo.');
  });
});
