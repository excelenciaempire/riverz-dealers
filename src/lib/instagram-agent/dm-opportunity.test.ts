import { describe, it, expect } from 'vitest';
import {
  decideCommentDm,
  heuristicDmDecision,
  parseDmDecision,
} from './dm-opportunity';

describe('heuristicDmDecision', () => {
  it('manda DM a quien pregunta precio', () => {
    expect(heuristicDmDecision('cuánto vale? 😍', 'Hola!')).toEqual({
      dm: true,
      reason: 'compra',
    });
  });

  it('una duda de pedido va al privado antes que la de compra', () => {
    expect(heuristicDmDecision('mi pedido no me llegó', 'Ya lo reviso')).toEqual(
      { dm: true, reason: 'pedido' },
    );
  });

  it('un reclamo va al privado', () => {
    const out = heuristicDmDecision('esto es una estafa', 'Lo vemos');
    expect(out).toEqual({ dm: true, reason: 'reclamo' });
  });

  it('un halago no abre el privado', () => {
    expect(heuristicDmDecision('qué linda foto 😍', 'Gracias!')).toEqual({
      dm: false,
      reason: 'ninguna',
    });
  });

  it('si la respuesta lleva enlace o precio, va al privado', () => {
    expect(
      heuristicDmDecision('qué lindo', 'Mirá acá https://tienda.com/serum').dm,
    ).toBe(true);
    expect(heuristicDmDecision('qué lindo', 'Sale $45.000').reason).toBe(
      'privado',
    );
  });
});

describe('parseDmDecision', () => {
  it('parsea el JSON aunque venga con texto alrededor', () => {
    expect(parseDmDecision('claro: {"dm":true,"reason":"compra"} fin')).toEqual({
      dm: true,
      reason: 'compra',
    });
  });

  it('devuelve null si no hay JSON válido', () => {
    expect(parseDmDecision('no sé')).toBeNull();
  });

  it('normaliza un motivo desconocido', () => {
    expect(parseDmDecision('{"dm":false,"reason":"xx"}')).toEqual({
      dm: false,
      reason: 'ninguna',
    });
  });
});

describe('decideCommentDm', () => {
  it('los modos fijos no consultan al modelo', async () => {
    await expect(
      decideCommentDm({ mode: 'dm', apiKey: null, comment: 'hola', reply: 'hola' }),
    ).resolves.toMatchObject({ dm: true });
    await expect(
      decideCommentDm({
        mode: 'public',
        apiKey: null,
        comment: 'cuánto vale',
        reply: 'x',
      }),
    ).resolves.toMatchObject({ dm: false });
  });

  it('public_smart sin modelo cae en la heurística', async () => {
    await expect(
      decideCommentDm({
        mode: 'public_smart',
        apiKey: null,
        comment: 'qué linda 😍',
        reply: 'gracias!',
      }),
    ).resolves.toEqual({ dm: false, reason: 'ninguna' });
  });

  it('una duda de pedido siempre abre el privado', async () => {
    await expect(
      decideCommentDm({
        mode: 'public_smart',
        apiKey: null,
        comment: 'hola',
        reply: 'tu envío salió ayer',
        hasOrderQuestion: true,
      }),
    ).resolves.toEqual({ dm: true, reason: 'pedido' });
  });
});
