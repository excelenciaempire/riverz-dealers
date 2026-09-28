import { expect, it, vi } from 'vitest';
import { summarizeActivity, walletActivity } from './activity';
import { summarizeMovements, type MovimientoResumen } from './movimientos';
import { costoPorConcepto } from './costos';
const range = { desde: '2026-09-27T03:00:00Z', hasta: '2026-09-28T03:00:00Z' };
const row = (id: string, centavos = -10, conversation = 'chat'): MovimientoResumen => ({ id, tipo: 'consumo', concepto: 'ia_respuesta', centavos, cantidad: 1, creado_en: '2026-09-27T19:00:00Z', detalle: { conversacion: conversation } });
const conversations = [{ id: 'chat', channel: 'whatsapp', contact_id: 'c' }, { id: 'email', channel: 'gmail', contact_id: 'c' }];
it('classifies app assistance separately without guessing historical customer channels', () => {
  const result=summarizeActivity([{...row('1'),concepto:'ia_asistencia',detalle:{}},{...row('2'),detalle:{}},{...row('3'),detalle:{superficie:'panel'}}]);
  expect(result.byChannel.find(c=>c.channel==='panel')).toMatchObject({charges:1,chargedCentavos:10,contacts:0});
  expect(result.byChannel.find(c=>c.channel==='unattributed')).toMatchObject({charges:2,chargedCentavos:20});
});
it('counts only actual debits, not tests, courtesy, credits or internal Stripe costs', () => {
  const result = summarizeActivity([row('paid'), row('test', 0), row('courtesy', 0), { ...row('credit', 2500), tipo: 'recarga' }, { ...row('fee'), concepto: 'comision_stripe' }], conversations);
  expect(result).toMatchObject({ contacts: 1, charges: 1, chargedCentavos: 10 });
});
it('counts distinct charged contacts per channel and globally without counting messages', () => {
  const result = summarizeActivity([row('1'), row('2'), row('3', -5, 'email')], conversations);
  expect(result).toMatchObject({ contacts: 1, charges: 3, chargedCentavos: 25 });
  expect(result.byChannel).toEqual([{ channel: 'whatsapp', contacts: 1, charges: 2, chargedCentavos: 20 }, { channel: 'gmail', contacts: 1, charges: 1, chargedCentavos: 5 }]);
});
it('retains unattributed charges so activity and spend totals reconcile exactly', () => {
  const rows = [row('1'), { ...row('2'), detalle: null }];
  const activity = summarizeActivity(rows, conversations);
  expect(activity.byChannel.find(c => c.channel === 'unattributed')).toMatchObject({ contacts: 0, charges: 1, chargedCentavos: 10 });
  expect(activity.chargedCentavos).toBe(summarizeMovements(rows, range).gastadoCentavos);
});
it('today and wider ranges agree when earlier activity was not charged', () => {
  const paid = [row('1'), row('2', -15)];
  const history = [{ ...row('test', 0), creado_en: '2026-09-25T19:00:00Z' }, ...paid];
  expect(summarizeActivity(history, conversations)).toEqual(summarizeActivity(paid, conversations));
  expect(summarizeMovements(history, range).porDia).toEqual(summarizeMovements(paid, range).porDia);
  expect(costoPorConcepto(history)).toEqual({ ia_respuesta: 12.5 });
});
it('uses the supplied billing snapshot and resolves only paid operations in the same workspace', async () => {
  const op = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ id: 'op', detalle: { conversacion: 'chat', canal: 'whatsapp' } }], error: null }) };
  const conv = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [conversations[0]], error: null }) };
  const from = vi.fn((table: string) => table === 'wallet_operaciones' ? op : conv);
  const result = await walletActivity({ from } as never, 'ws', range, [{ ...row('1'), detalle: {}, referencia_tipo: 'provider_operation', referencia_id: 'op' }, row('free', 0)]);
  expect(result).toMatchObject({ contacts: 1, charges: 1, chargedCentavos: 10 });
  expect(from.mock.calls.map(([table]) => table)).toEqual(['wallet_operaciones', 'conversations']);
  expect(op.eq).toHaveBeenCalledWith('workspace_id', 'ws');
  expect(conv.eq).toHaveBeenCalledWith('workspace_id', 'ws');
});
it('does not read all customer messages or fetch attribution when there are no debits', async () => {
  const from = vi.fn();
  expect(await walletActivity({ from } as never, 'ws', range, [row('test', 0)])).toEqual({ contacts: 0, charges: 0, chargedCentavos: 0, byChannel: [] });
  expect(from).not.toHaveBeenCalled();
});
it('does not fabricate zero activity when attribution fails', async () => {
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: null, error: new Error('unavailable') }) };
  await expect(walletActivity({ from: () => q } as never, 'ws', range, [row('1')])).rejects.toThrow('unavailable');
});
it('recovers exact contact, call and external publication references without changing the billing snapshot', async () => {
  const tables = {
    contacts: [{ id: 'customer', channel: 'whatsapp' }],
    voice_calls: [{ id: 'call', contact_id: 'customer' }],
    publicacion_contexto: [{ external_id: 'external-post', channel: 'fb_comment' }],
    conversations: [conversations[0]],
  };
  const queries = new Map<string, { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn> }>();
  const from = vi.fn((table: keyof typeof tables) => {
    const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: tables[table], error: null }) };
    queries.set(table, q); return q;
  });
  const rows: MovimientoResumen[] = [
    { ...row('contact', -1937), detalle: {}, referencia_tipo: 'contact', referencia_id: 'customer' },
    { ...row('call', -10), detalle: {}, referencia_tipo: 'voice_call', referencia_id: 'call' },
    { ...row('post', -7), detalle: {}, referencia_tipo: 'publicacion', referencia_id: 'external-post' },
    { ...row('nested', -5), detalle: { referenciaTipo: 'conversation', referenciaId: 'chat' } },
    { ...row('missing', -11), detalle: {} },
  ];
  const before = structuredClone(rows);
  const result = await walletActivity({ from } as never, 'ws', range, rows);
  expect(rows).toEqual(before);
  expect(result.chargedCentavos).toBe(1970);
  expect(result.contacts).toBe(2);
  expect(result.byChannel.find(c => c.channel === 'whatsapp')).toMatchObject({ charges: 2, chargedCentavos: 1942 });
  expect(result.byChannel.find(c => c.channel === 'calls')).toMatchObject({ contacts: 1, chargedCentavos: 10 });
  expect(result.byChannel.find(c => c.channel === 'fb_comment')).toMatchObject({ chargedCentavos: 7 });
  expect(result.unrecorded).toMatchObject({ charges: 1, chargedCentavos: 11 });
  for (const query of queries.values()) expect(query.eq).toHaveBeenCalledWith('workspace_id', 'ws');
  expect(queries.get('publicacion_contexto')?.in).toHaveBeenCalledWith('external_id', ['external-post']);
});
it('preserves missing historical amounts and exact date bounds separately from channels', () => {
  const result = summarizeActivity([
    { ...row('later', -40), detalle: {}, creado_en: '2026-09-27T20:05:00Z' },
    { ...row('earlier', -10), detalle: {}, creado_en: '2026-09-01T09:03:00Z' },
    row('known', -5),
  ], conversations);
  expect(result.unrecorded).toEqual({ charges: 2, chargedCentavos: 50, firstAt: '2026-09-01T09:03:00Z', lastAt: '2026-09-27T20:05:00Z' });
  expect(result.chargedCentavos).toBe(55);
});
it('does not guess the network when an external publication ID is ambiguous', async () => {
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [
    { external_id: 'same-id', channel: 'instagram' }, { external_id: 'same-id', channel: 'fb_comment' },
  ], error: null }) };
  const result = await walletActivity({ from: () => q } as never, 'ws', range, [{ ...row('ambiguous'), detalle: {}, referencia_tipo: 'publicacion', referencia_id: 'same-id' }]);
  expect(result.unrecorded?.chargedCentavos).toBe(10);
  expect(result.byChannel).toEqual([{ channel: 'unattributed', charges: 1, contacts: 0, chargedCentavos: 10 }]);
});
