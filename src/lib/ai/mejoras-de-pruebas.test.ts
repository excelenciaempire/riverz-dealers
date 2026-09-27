import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ generate: vi.fn(), apply: vi.fn(), enqueue: vi.fn(), deleted: false }));
vi.mock('./mejoras', () => ({
  generarPropuestas: m.generate,
  aplicarSolasSiCorresponde: m.apply,
  encolarParaPlataforma: m.enqueue,
  transcripcionDeFeedbackReal: () => 'feedback',
}));
import { mejorarFeedbackReal, mejorarSesionDePrueba } from './mejoras-de-pruebas';

function fakeDb() {
  const writes = vi.fn();
  const db = { from: (table: string) => {
    let single = false;
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) q[method] = () => q;
    for (const method of ['update', 'insert', 'delete']) q[method] = () => { writes(); return q; };
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: (value: unknown) => void) => resolve({ error: null, data: m.deleted ? (single ? null : []) : table === 'ai_test_sessions'
      ? { items: [{ k: 'biz', texto: 'Respuesta' }], feedback: [{ item: 0, voto: 'mal', nota: 'Corregir', at: '2026-09-27' }] }
      : [{ id: 'f', captura: [], voto: 'mal', nota: 'Corregir' }] });
    return q;
  } } as unknown as SupabaseClient;
  return { db, writes };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.deleted = false;
  m.generate.mockImplementation(async () => {
    // Deletion occurs while the model is processing its earlier snapshot.
    m.deleted = true;
    return { reglas: [], plataforma: [{ problema: 'old', prompt: 'old' }] };
  });
});
it('does not apply, save or enqueue a test deleted during generation', async () => {
  const { db, writes } = fakeDb();
  expect(await mejorarSesionDePrueba(db, 'w', 's')).toBe('no_existe');
  expect(m.generate).toHaveBeenCalledOnce();
  expect(m.apply).not.toHaveBeenCalled();
  expect(m.enqueue).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
});
it('discards a generated batch if any input was deleted during generation', async () => {
  const { db, writes } = fakeDb();
  expect(await mejorarFeedbackReal(db, 'w', { automatico: true })).toBe('sin_feedback');
  expect(m.generate).toHaveBeenCalledOnce();
  expect(m.apply).not.toHaveBeenCalled();
  expect(m.enqueue).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
});
