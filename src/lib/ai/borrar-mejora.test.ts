import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { borrarMejora, feedbackVigente, loteVigente } from './borrar-mejora';

type Row = Record<string, unknown>;
interface Query {
  select(): Query;
  update(value: Row): Query;
  delete(): Query;
  eq(key: string, value: unknown): Query;
  neq(key: string, value: unknown): Query;
  in(key: string, values: unknown[]): Query;
  overlaps(key: string, values: unknown[]): Query;
  maybeSingle(): Query;
  then(resolve: (r: unknown) => void): void;
}
function memory(tables: Record<string, Row[]>, fail = '') {
  const from = vi.fn((table: string) => {
    let action = 'select';
    let patch: Row = {};
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const q: Query = {
      select: () => q,
      update: (value: Row) => { action = 'update'; patch = value; return q; },
      delete: () => { action = 'delete'; return q; },
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return q; },
      neq: (key: string, value: unknown) => { filters.push(r => r[key] !== value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(r => values.includes(r[key])); return q; },
      overlaps: (key: string, values: unknown[]) => { filters.push(r => (r[key] as unknown[]).some(v => values.includes(v))); return q; },
      maybeSingle: () => { single = true; return q; },
      then: (resolve: (r: unknown) => void) => {
        if (`${table}:${action}` === fail) return resolve({ error: { message: 'unavailable' }, data: null });
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
        if (action === 'update') rows.forEach(r => Object.assign(r, patch));
        if (action === 'delete') tables[table] = (tables[table] ?? []).filter(r => !rows.includes(r));
        return resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length });
      },
    };
    return q;
  });
  return { db: { from } as unknown as SupabaseClient, from, tables };
}

describe('permanent, scoped evaluation deletion', () => {
  it('deletes real feedback and whole derived batches/queue without touching live data or another merchant', async () => {
    const s = memory({
      ai_feedback: [{ id: 'f', workspace_id: 'w', estado: 'nuevo', captura: ['private'] }, { id: 'keep', workspace_id: 'other' }],
      ai_mejoras_lotes: [{ id: 'batch', workspace_id: 'w', feedback_ids: ['f', 'another'], propuestas: {} }, { id: 'other', workspace_id: 'other', feedback_ids: ['f'] }],
      mejoras_plataforma: [{ id: 'derived', workspace_id: 'w', origen: 'bandeja', origen_id: 'batch' }, { id: 'keep', workspace_id: 'w', origen: 'prueba', origen_id: 'session' }],
      messages: [{ id: 'message' }], agent_guidance: [{ id: 'already-applied' }],
    });
    expect(await borrarMejora(s.db, 'w', 'borrar-feedback', 'f')).toEqual({ deleted: 1 });
    expect(s.tables.ai_feedback.map(r => r.id)).toEqual(['keep']);
    expect(s.tables.ai_mejoras_lotes.map(r => r.id)).toEqual(['other']);
    expect(s.tables.mejoras_plataforma.map(r => r.id)).toEqual(['keep']);
    expect(s.tables.messages).toEqual([{ id: 'message' }]);
    expect(s.tables.agent_guidance).toEqual([{ id: 'already-applied' }]);
  });
  it.each(['borrar-prueba', 'borrar-pruebas'] as const)('%s cleans source and related queue, never another workspace', async que => {
    const s = memory({
      ai_test_sessions: [{ id: 's', workspace_id: 'w', feedback: ['bad'] }, { id: 's2', workspace_id: 'other' }],
      mejoras_plataforma: [{ id: 'p', workspace_id: 'w', origen: 'prueba', origen_id: 's' }, { id: 'q', workspace_id: 'other', origen: 'prueba', origen_id: 's2' }],
    });
    await borrarMejora(s.db, 'w', que, que === 'borrar-pruebas' ? 'w' : 's');
    expect(s.tables.ai_test_sessions.map(r => r.id)).toEqual(['s2']);
    expect(s.tables.mejoras_plataforma.map(r => r.id)).toEqual(['q']);
  });
  it('deleting a platform item also removes its saved proposal copy', async () => {
    const s = memory({
      mejoras_plataforma: [{ id: 'p', workspace_id: 'w', origen: 'prueba', origen_id: 's', problema: 'bad', prompt: 'fix' }],
      ai_test_sessions: [{ id: 's', workspace_id: 'w', propuestas: { reglas: [], plataforma: [{ problema: 'bad', prompt: 'fix' }, { problema: 'keep', prompt: 'other' }] } }],
    });
    await borrarMejora(s.db, 'w', 'borrar-plataforma', 'p');
    expect(s.tables.mejoras_plataforma).toEqual([]);
    expect((s.tables.ai_test_sessions[0].propuestas as { plataforma: unknown[] }).plataforma).toEqual([{ problema: 'keep', prompt: 'other' }]);
  });
  it('deletes template change requests, not active templates', async () => {
    const s = memory({ cambios_de_plantilla: [{ id: 'c', workspace_id: 'w' }], message_templates: [{ id: 'live' }] });
    await borrarMejora(s.db, 'w', 'borrar-cambio', 'c');
    expect(s.tables.cambios_de_plantilla).toEqual([]);
    expect(s.tables.message_templates).toEqual([{ id: 'live' }]);
  });
  it('a cleanup failure does not report success; the source is already excluded from optimization', async () => {
    const s = memory({
      ai_feedback: [{ id: 'f', workspace_id: 'w', estado: 'nuevo' }],
      ai_mejoras_lotes: [{ id: 'batch', workspace_id: 'w', feedback_ids: ['f'] }],
    }, 'ai_mejoras_lotes:delete');
    await expect(borrarMejora(s.db, 'w', 'borrar-feedback', 'f')).rejects.toThrow('unavailable');
    expect(await feedbackVigente(s.db, 'w', ['f'])).toBe(false);
    expect(await loteVigente(s.db, 'w', 'batch')).toBe(false);
  });
  it('wrong workspace cannot delete or apply a record', async () => {
    const s = memory({ ai_feedback: [{ id: 'f', workspace_id: 'other', estado: 'nuevo' }] });
    expect(await borrarMejora(s.db, 'w', 'borrar-feedback', 'f')).toEqual({ deleted: 0 });
    expect(s.tables.ai_feedback).toHaveLength(1);
    expect(await feedbackVigente(s.db, 'w', ['f'])).toBe(false);
  });
  it('rejects stale batch IDs and failed source reads', async () => {
    const tables = { ai_mejoras_lotes: [{ id: 'b', workspace_id: 'w', feedback_ids: ['deleted'], propuestas: {} }], ai_feedback: [] };
    expect(await loteVigente(memory(tables).db, 'w', 'b')).toBe(false);
    expect(await loteVigente(memory(tables).db, 'w', 'missing')).toBe(false);
    expect(await feedbackVigente(memory(tables, 'ai_feedback:select').db, 'w', ['deleted'])).toBe(false);
  });
  it('only accepts batches whose proposals and every input are still present', async () => {
    const s = memory({ ai_mejoras_lotes: [{ id: 'b', workspace_id: 'w', feedback_ids: ['f'], propuestas: {} }],
      ai_feedback: [{ id: 'f', workspace_id: 'w', estado: 'usado' }] });
    expect(await loteVigente(s.db, 'w', 'b')).toBe(true);
    s.tables.ai_mejoras_lotes[0].propuestas = null;
    expect(await loteVigente(s.db, 'w', 'b')).toBe(false);
  });
});
