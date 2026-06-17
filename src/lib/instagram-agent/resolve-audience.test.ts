import { describe, it, expect } from 'vitest';
import { mergeAudience, type AudienceContact } from './resolve-audience';

const c = (id: string): AudienceContact => ({ id, external_id: `ext-${id}` });

describe('mergeAudience', () => {
  it('prioriza comentaristas antes que DMers', () => {
    const out = mergeAudience([c('a'), c('b')], [c('x'), c('y')], 10);
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'x', 'y']);
  });

  it('deduplica por id (un contacto en ambas listas no se repite)', () => {
    const out = mergeAudience([c('a'), c('b')], [c('b'), c('z')], 10);
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'z']);
  });

  it('respeta el tope priorizando comentaristas', () => {
    const out = mergeAudience([c('a'), c('b'), c('c')], [c('x')], 2);
    expect(out.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('maneja listas vacías', () => {
    expect(mergeAudience([], [], 5)).toEqual([]);
    expect(mergeAudience([], [c('x')], 5).map((o) => o.id)).toEqual(['x']);
  });
});
