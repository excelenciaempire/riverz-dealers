import { describe, expect, it } from 'vitest';
import { revitalyTransferShippingReply, REVITALY_SHIPPING_RULE } from './revitaly-transfer-shipping';
import type { Regla } from './guidance';

const rule = { workspace_id: '234604a9-909b-4e50-952b-acde4a85593a', agent_id: null,
  clave: REVITALY_SHIPPING_RULE, activa: true } as Regla;
const input = { workspaceId: rule.workspace_id, agentId: 'natalia', channel: 'whatsapp' as const,
  language: 'es', inbound: 'Transferencia', rules: [rule] };
const submitted = 'Nombre y apellido: Ana López\nDNI: 30123456\nTeléfono: 5491123456789\nEmail: ana@example.com\nCalle: Rivadavia\nNúmero: 1200\nCódigo postal: 1001\nCiudad / Localidad: Buenos Aires\nProvincia: Buenos Aires';

describe('Revitaly written transfer shipping details', () => {
  it('asks every field in the requested order, with an optional apartment and no payment confirmation', () => {
    const text = revitalyTransferShippingReply(input)!;
    const labels = ['Nombre y apellido:', 'DNI:', 'Teléfono:', 'Email:', 'Calle:', 'Número:', 'Piso / Dpto', 'Código postal:', 'Ciudad / Localidad:', 'Provincia:'];
    for (let i = 1; i < labels.length; i++) expect(text.indexOf(labels[i])).toBeGreaterThan(text.indexOf(labels[i - 1]));
    expect(text).toContain('No aceptamos ubicaciones de Google Maps');
    expect(text).not.toMatch(/pago (?:confirmado|acreditado)|despachado/i);
  });
  it('requests only fields still missing after a partial submission', () => {
    const text = revitalyTransferShippingReply({ ...input, inbound: 'Nombre y apellido: Ana López\nDNI: 30123456',
      history: [{ role: 'user', content: 'Transferencia' }, { role: 'assistant', content: revitalyTransferShippingReply(input)! }] })!;
    expect(text).toContain('solo los datos');
    expect(text).not.toContain('• Nombre y apellido:');
    expect(text).not.toContain('• DNI:');
    expect(text).toContain('• Email:');
    expect(text).not.toContain('• Piso');
  });
  it('does not accept a map link as a street or require an optional floor', () => {
    const history = [{ role: 'user', content: 'Transferencia' }, { role: 'assistant', content: revitalyTransferShippingReply(input)! }];
    expect(revitalyTransferShippingReply({ ...input, inbound: submitted, history })).toBeNull();
    const text = revitalyTransferShippingReply({ ...input, inbound: submitted.replace('Calle: Rivadavia', 'Calle: https://maps.google.com/?q=Rivadavia'), history })!;
    expect(text).toContain('• Calle:');
    expect(text).not.toContain('• DNI:');
  });
  it('asks for written details when the customer offers a location after choosing transfer', () => {
    const text = revitalyTransferShippingReply({ ...input, inbound: 'Te paso mi ubicación https://maps.app.goo.gl/test',
      history: [{ role: 'user', content: 'Transferencia' }, { role: 'assistant', content: revitalyTransferShippingReply(input)! }] })!;
    expect(text).toContain('por escrito');
    expect(text).toContain('• Número:');
  });
  it('handles a receipt without declaring funds received', () => {
    const text = revitalyTransferShippingReply({ ...input, inbound: 'Ya transferí, adjunto comprobante de Mercado Pago' })!;
    expect(text).toContain('• DNI:');
    expect(text).not.toMatch(/pago (?:confirmado|acreditado)|dinero recibido/i);
  });
  it('never accepts transcribed audio or image observations instead of written shipping fields', () => {
    const text = revitalyTransferShippingReply({ ...input, inbound: `[Audio transcrito]: ${submitted}`,
      history: [{ role: 'user', content: 'Transferencia' }, { role: 'assistant', content: revitalyTransferShippingReply(input)! }] })!;
    expect(text).toContain('• DNI:');
    expect(text).toContain('• Calle:');
    expect(text).not.toMatch(/\n\s*\n/);
  });
  it('supports English and never applies on Mercado Libre, public posts, email or another merchant', () => {
    expect(revitalyTransferShippingReply({ ...input, language: 'en', inbound: 'Bank transfer' })).toContain('Full name:');
    for (const channel of ['mercadolibre', 'ig_comment', 'fb_comment', 'gmail', 'instagram', 'messenger'] as const)
      expect(revitalyTransferShippingReply({ ...input, channel })).toBeNull();
    expect(revitalyTransferShippingReply({ ...input, workspaceId: 'other' })).toBeNull();
    expect(revitalyTransferShippingReply({ ...input, rules: [{ ...rule, activa: false }] })).toBeNull();
  });
  it.each(['Quiero un reembolso de la transferencia', 'No quiero transferencia', '¿Dónde está mi pedido? No llegó', 'Ya pagué con tarjeta', '¿Me das el alias?'])
    ('does not restart an unrelated payment or support conversation: %s', inbound => {
      expect(revitalyTransferShippingReply({ ...input, inbound })).toBeNull();
    });
  it('respects a customer who chose pickup instead of home delivery', () => {
    expect(revitalyTransferShippingReply({ ...input, history: [{ role: 'user', content: 'Quiero retirar en sucursal' }] })).toBeNull();
  });
  it('requests a fresh form for a new transfer purchase rather than reusing an old address', () => {
    const text = revitalyTransferShippingReply({ ...input, history: [
      { role: 'user', content: 'Transferencia' }, { role: 'assistant', content: revitalyTransferShippingReply(input)! },
      { role: 'user', content: submitted }, { role: 'assistant', content: 'Compra entregada' },
    ] })!;
    expect(text).toContain('• Calle:');
    expect(text).toContain('• DNI:');
  });
  it('asks for invalid mandatory fields again, and respects a switch to card payment', () => {
    const history = [{ role: 'user', content: 'Transferencia' }, { role: 'assistant', content: revitalyTransferShippingReply(input)! }];
    const text = revitalyTransferShippingReply({ ...input, history, inbound: submitted.replace('30123456', 'hola').replace('ana@example.com', 'no tengo') })!;
    expect(text).toContain('• DNI:');
    expect(text).toContain('• Email:');
    expect(text).not.toContain('• Calle:');
    expect(revitalyTransferShippingReply({ ...input, history, inbound: 'Ya pagué con tarjeta' })).toBeNull();
  });
});
