import { expect, it, vi } from 'vitest';
import { summarizeActivity, walletActivity } from './activity';
import { summarizeMovements, type MovimientoResumen } from './movimientos';
import { costoPorConcepto } from './costos';
const range = { desde: '2026-09-27T03:00:00Z', hasta: '2026-09-28T03:00:00Z' };
const row = (id: string, centavos = -10, conversation = 'chat'): MovimientoResumen => ({ id, tipo: 'consumo', concepto: 'ia_respuesta', centavos, cantidad: 1, creado_en: '2026-09-27T19:00:00Z', detalle: { conversacion: conversation } });
const conversations = [{ id: 'chat', channel: 'whatsapp', contact_id: 'c' }, { id: 'email', channel: 'gmail', contact_id: 'c' }];
it('classifies app assistance separately without guessing historical customer channels', () => {
  const result=summarizeActivity([{...row('1'),concepto:'ia_asistencia',detalle:{}},{...row('2'),detalle:{}},{...row('3'),detalle:{superficie:'panel'}}]);
  expect(result.byChannel.find(c=>c.channel==='panel')).toMatchObject({charges:2,chargedCentavos:20,contacts:0});
  expect(result.byChannel.find(c=>c.channel==='unattributed')).toMatchObject({charges:1,chargedCentavos:10});
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
