import { describe, expect, it } from 'vitest';
import {
  analyzeCommentMetrics,
  parseMarketResearchResponse,
  redactComment,
} from './market-research';

describe('market research comments', () => {
  it('derives exact market signals from every comment', () => {
    const metrics = analyzeCommentMetrics([
      {
        channel: 'ig_comment',
        text: 'Hola, cuánto cuesta? Me interesa',
        createdAt: '2026-09-01T00:00:00Z',
      },
      {
        channel: 'fb_comment',
        text: 'Excelente, me encanta',
        createdAt: '2026-09-01T00:00:00Z',
      },
      {
        channel: 'tiktok_comment',
        text: 'No funciona, qué decepción',
        createdAt: '2026-09-01T00:00:00Z',
      },
    ]);
    expect(metrics.total).toBe(3);
    expect(metrics.byChannel).toEqual({
      ig_comment: 1,
      fb_comment: 1,
      tiktok_comment: 1,
    });
    expect(metrics.sentiment).toEqual({ positive: 1, neutral: 1, negative: 1 });
    expect(
      metrics.signals.find((signal) => signal.key === 'price')?.count
    ).toBe(1);
    expect(
      metrics.signals.find((signal) => signal.key === 'complaint')?.count
    ).toBe(1);
  });

  it('removes contact data before a model sees comment text', () => {
    expect(
      redactComment('Escribe al +54 11 5555-1234 o a hola@marca.com')
    ).toBe('Escribe al [teléfono] o a [email]');
  });

  it('accepts only a complete structured model answer', () => {
    expect(
      parseMarketResearchResponse(
        '{"summary":"Resumen","findings":[{"title":"Precio","detail":"Se pregunta por costo"}],"opportunities":["Mostrar precio"],"risks":[],"actions":["Actualizar anuncio"]}'
      )
    ).toMatchObject({ summary: 'Resumen', findings: [{ title: 'Precio' }] });
    expect(
      parseMarketResearchResponse('{"summary":"sin hallazgos"}')
    ).toBeNull();
  });
});
