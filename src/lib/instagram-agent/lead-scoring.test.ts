import { describe, it, expect } from 'vitest';
import { parseScoreResponse } from './lead-scoring';

describe('parseScoreResponse', () => {
  it('parsea un array alineado por índice', () => {
    const txt = JSON.stringify([
      { i: 0, score: 'high', sentiment: 'positive', spam: false },
      { i: 1, score: 'low', sentiment: 'negative', spam: true },
    ]);
    const out = parseScoreResponse(txt, 2);
    expect(out[0]).toEqual({ score: 'high', sentiment: 'positive', spam: false });
    expect(out[1]).toEqual({ score: 'low', sentiment: 'negative', spam: true });
  });

  it('cae a default neutro no-spam cuando el JSON es inválido', () => {
    const out = parseScoreResponse('no json aquí', 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ score: 'low', sentiment: 'neutral', spam: false });
  });

  it('ignora índices fuera de rango y valores inválidos', () => {
    const txt = JSON.stringify([
      { i: 5, score: 'high' },
      { i: 0, score: 'invalido', sentiment: 'x', spam: 'sí' },
    ]);
    const out = parseScoreResponse(txt, 1);
    // i=5 descartado; i=0 con valores inválidos → defaults
    expect(out[0]).toEqual({ score: 'low', sentiment: 'neutral', spam: false });
  });

  it('extrae el array aunque venga con texto alrededor', () => {
    const out = parseScoreResponse(
      'aquí va: [{"i":0,"score":"medium","sentiment":"neutral","spam":false}] fin',
      1,
    );
    expect(out[0].score).toBe('medium');
  });
});
