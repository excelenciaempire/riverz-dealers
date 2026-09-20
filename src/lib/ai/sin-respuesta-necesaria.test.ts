import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ jev: vi.fn(), available: true, fallback: vi.fn() }));
vi.mock('./jev', () => ({ hayJev: () => m.available, preguntarJev: m.jev }));
vi.mock('./medido', () => ({ completeTextMedido: m.fallback }));
import { cierreDesdeJev, sinRespuestaNecesaria } from './sin-respuesta-necesaria';
import { politicaDe } from './desenlace';

const input = { workspaceId: 'w', conversationId: 'c', messageId: 'in', createdAt: '2026-09-20T02:31:28Z', text: 'No muchas gracias' };
const outgoing = { id: 'out', sender_type: 'bot', content_type: 'text', content_text: '¿Algo más?', media_url: null };
const incoming = { id: 'in', sender_type: 'customer', content_type: 'text', content_text: input.text, media_url: null };
function database(rows: Array<Omit<typeof incoming, 'media_url'> & { media_url: string | null }> = [incoming, outgoing], error: unknown = null) {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'neq', 'lte', 'order']) q[method] = vi.fn(() => q);
  q.limit = vi.fn(async () => ({ data: rows, error }));
  return { from: vi.fn(() => q) } as never;
}
function answer(close: number, action: number) {
  return { solo_cierre: { type: 'noul' as const, noul: close }, requiere_accion: { type: 'noul' as const, noul: action } };
}
beforeEach(() => {
  m.available = true; m.jev.mockReset(); m.fallback.mockReset();
  m.jev.mockResolvedValue({ answers: answer(0.99, 0.01) });
});

describe('silencio al terminar una conversación', () => {
  it('un cierre claro no genera respuesta ni escalada', async () => {
    expect(await sinRespuestaNecesaria(database(), input)).toBe(true);
    expect(politicaDe('cierre_sin_respuesta')).toMatchObject({ escala: null, apaga: false, contestado: false });
  });
  it('una confirmación que requiere actuar o una decisión incierta se atiende', () => {
    expect(cierreDesdeJev(answer(0.99, 0.9))).toBe(false);
    expect(cierreDesdeJev(answer(0.6, 0.02))).toBe(false);
    expect(cierreDesdeJev(answer(NaN, 0))).toBe(false);
  });
  it('incluye la pregunta pendiente anterior a gracias en la misma evaluación', async () => {
    m.jev.mockResolvedValue({ answers: answer(0.02, 0.99) });
    const question = { ...incoming, id: 'question', content_text: '¿Cuándo llega?' };
    expect(await sinRespuestaNecesaria(database([incoming, question, outgoing]), input)).toBe(false);
    expect(m.jev.mock.calls[0][0].state.turno_pendiente).toEqual(['¿Cuándo llega?', 'No muchas gracias']);
  });
  it('un adjunto pendiente no se interpreta como un cierre', async () => {
    const photo = { ...incoming, id: 'photo', content_type: 'image', media_url: 'https://example.com/proof.jpg' };
    expect(await sinRespuestaNecesaria(database([incoming, photo, outgoing]), input)).toBe(false);
    expect(m.jev).not.toHaveBeenCalled();
  });
  it('no silencia sin historial o cuando falla la lectura', async () => {
    expect(await sinRespuestaNecesaria(database([incoming]), input)).toBe(false);
    expect(await sinRespuestaNecesaria(database([], new Error('down')), input)).toBe(false);
  });
  it('conserva el respaldo cuando Jev no está disponible', async () => {
    m.available = false; m.fallback.mockResolvedValue('CIERRE');
    expect(await sinRespuestaNecesaria(database(), input)).toBe(true);
    expect(m.jev).not.toHaveBeenCalled();
  });
  it('acepta la etiqueta Markdown del respaldo sin buscar palabras en la explicación', async () => {
    m.available = false;
    m.fallback.mockResolvedValue('**CIERRE**\n\nEl cliente agradece.');
    expect(await sinRespuestaNecesaria(database(), input)).toBe(true);
    m.fallback.mockResolvedValue('**ATENDER**\n\nNo es un CIERRE.');
    expect(await sinRespuestaNecesaria(database(), input)).toBe(false);
  });
  it('una caída o salida inválida del respaldo no silencia una consulta', async () => {
    m.jev.mockResolvedValue(null);
    for (const result of [null, 'ATENDER', 'CIERRE porque sí']) {
      m.fallback.mockResolvedValue(result);
      expect(await sinRespuestaNecesaria(database(), input)).toBe(false);
    }
    m.fallback.mockRejectedValue(new Error('network'));
    expect(await sinRespuestaNecesaria(database(), input)).toBe(false);
  });
});
