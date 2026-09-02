import { describe, expect, it } from 'vitest';
import {
  analyzeCommentMetrics,
  buildEvidenceActions,
  filterCommentsByCategory,
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

  it('uses the same deterministic rule for each visible category and its detail', () => {
    const comments = [
      { channel: 'ig_comment' as const, text: '¿Cuánto cuesta?', createdAt: '2026-09-01T00:00:00Z' },
      { channel: 'fb_comment' as const, text: 'No funciona', createdAt: '2026-09-02T00:00:00Z' },
      { channel: 'tiktok_comment' as const, text: 'Me encanta', createdAt: '2026-09-03T00:00:00Z' },
    ];
    const metrics = analyzeCommentMetrics(comments);
    expect(filterCommentsByCategory(comments, 'price')).toHaveLength(
      metrics.signals.find((signal) => signal.key === 'price')?.count ?? 0
    );
    expect(filterCommentsByCategory(comments, 'negative')).toHaveLength(
      metrics.sentiment.negative
    );
  });

  it('creates actions only when the full corpus has the supporting signal', () => {
    const metrics = analyzeCommentMetrics([
      { channel: 'ig_comment', text: '¿Cuánto cuesta?', createdAt: '2026-09-01T00:00:00Z' },
      { channel: 'fb_comment', text: 'No funciona', createdAt: '2026-09-01T00:00:00Z' },
    ]);
    const actions = buildEvidenceActions(metrics, 'es');
    expect(actions.join(' ')).toContain('1 comentario pregunta por precio');
    expect(actions.join(' ')).toContain('1 comentario con posible fricción');
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
