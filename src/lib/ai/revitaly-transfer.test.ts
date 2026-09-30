import { describe, expect, it, vi } from 'vitest';
import type { Regla } from './guidance';
import { revitalyTransferReply } from './revitaly-transfer';
import { prometeAveriguar } from './salida';
import { simularRespuesta } from './simulacion';
import { resolveAnthropicKey } from './platform-key';

vi.mock('./platform-key', () => ({ resolveAnthropicKey: vi.fn() }));

const rule: Regla = {
  id: 'rule', workspace_id: '234604a9-909b-4e50-952b-acde4a85593a', agent_id: 'natalia',
  titulo: 'Transferencia', cuando: 'Pide alias', hacer:
    'Titular: Joaquin Federico Guerrero. CVU: 0000003100067538952577. Alias: fede.ecom. Verifica el pago.',
  activa: true, orden: 11, origen: 'comercio', clave: 'ofertas_pago_manual',
};
const opts = { workspaceId: rule.workspace_id, agentId: 'natalia', channel: 'whatsapp' as const,
  language: 'es', inbound: 'En un pago con transferencia vos me pasas alias.', rules: [rule] };

describe('Revitaly transfer details', () => {
  it.each(['En un pago con transferencia vos me pasas alias.', '¿Me pasas el alias?',
    'Pasame el CVU', 'Transferencia', 'Prefiero transferencia', 'Transferencia 10% OFF'])
  ('answers %s with the exact configured details', inbound => {
    const reply = revitalyTransferReply({ ...opts, inbound });
    expect(reply).toBe('Datos para transferir:\nTitular: Joaquin Federico Guerrero\nCVU: 0000003100067538952577\nAlias: fede.ecom');
    expect(prometeAveriguar(reply)).toBe(false);
    expect(reply).not.toContain('$');
  });

  it('uses updated merchant details and supports English private channels', () => {
    const updated = { ...rule, hacer: 'Titular: Nueva Cuenta. CVU: 1111111111111111111111. Alias: nueva.cuenta.' };
    for (const channel of ['whatsapp', 'instagram', 'messenger', 'webchat'] as const) {
      const reply = revitalyTransferReply({ ...opts, channel, language: 'en', inbound: 'Bank details please', rules: [updated] });
      expect(reply).toContain('Account holder: Nueva Cuenta');
      expect(reply).toContain('CVU: 1111111111111111111111');
      expect(reply).toContain('Alias: nueva.cuenta');
      expect(reply).not.toContain('fede.ecom');
    }
  });

  it('never shares details on public, marketplace or email channels or another merchant', () => {
    for (const channel of ['ig_comment', 'fb_comment', 'mercadolibre', 'gmail', 'outlook'] as const)
      expect(revitalyTransferReply({ ...opts, channel })).toBeNull();
    expect(revitalyTransferReply({ ...opts, workspaceId: 'other' })).toBeNull();
    expect(revitalyTransferReply({ ...opts, agentId: 'mercadolibre-agent' })).toBeNull();
  });

  it('falls back to the normal agent for inactive, missing, foreign or conflicting rules', () => {
    for (const rules of [[], [{ ...rule, activa: false }], [{ ...rule, workspace_id: 'other' }],
      [{ ...rule, hacer: 'Alias: fede.ecom.' }], [{ ...rule, hacer: 'Titular: Cuenta. CVU: 123. Alias: cuenta.' }],
      [rule, { ...rule, id: 'second' }]])
      expect(revitalyTransferReply({ ...opts, rules })).toBeNull();
  });

  it.each(['Ya transferí al alias', 'Te envío el comprobante del CVU', 'No quiero transferencia',
    'No funciona el alias', 'Quiero un reembolso al alias', 'Pasame alias y total', '¿49990 es?',
    '¿Cuánto tarda la transferencia?', '¿Cómo puedo pagar?'])
  ('leaves payment issues and broader questions to the normal agent: %s', inbound => {
    expect(revitalyTransferReply({ ...opts, inbound })).toBeNull();
  });

  it('replays the reported conversation through the shared simulation path without a model call', async () => {
    const query: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'order', 'limit', 'or']) query[name] = vi.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [rule] }).then(resolve);
    const db = { from: vi.fn(() => query) };
    const result = await simularRespuesta(db as never, { id: 'natalia', workspace_id: rule.workspace_id,
      name: 'Natalia', language: 'es', response_mode: 'multi' } as never, {
      message: opts.inbound, simulatedChannel: 'whatsapp',
      historial: [{ role: 'assistant', content: 'Transferencia: 10% OFF, la gestionamos por este chat.' }],
    });
    expect(result.reply).toBe(revitalyTransferReply(opts));
    expect(result.chunks).toEqual([result.reply]);
    expect(result.bloqueo).toBeUndefined();
    expect(resolveAnthropicKey).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledWith('agent_guidance');
  });
});
