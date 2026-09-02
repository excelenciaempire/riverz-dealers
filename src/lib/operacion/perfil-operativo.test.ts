import { describe, expect, it } from 'vitest';
import {
  estadoPreparacion,
  normalizarPerfilOperativo,
  perfilOperativoAPrompt,
  requiereModuloRegulado,
} from './perfil-operativo';

describe('perfil operativo', () => {
  it('normaliza únicamente datos operativos verificables', () => {
    const profile = normalizarPerfilOperativo({
      source: 'admin', vertical: 'regulated', checkoutMode: 'checkout',
      paymentMethods: ['tarjeta', '', 3], shippingPolicy: '  Entrega en 48 h.  ',
    });
    expect(profile).toMatchObject({ source: 'admin', vertical: 'regulated', checkoutMode: 'checkout' });
    expect(profile.paymentMethods).toEqual(['tarjeta']);
    expect(perfilOperativoAPrompt(profile)).toContain('Entrega en 48 h.');
  });

  it('preserva el resguardo regulado de las cuentas anteriores', () => {
    expect(requiereModuloRegulado(null)).toBe(true);
    expect(requiereModuloRegulado(normalizarPerfilOperativo({ vertical: 'general' }))).toBe(false);
  });

  it('bloquea la salida cuando faltan canal, catálogo o medios de pago', () => {
    expect(estadoPreparacion({ profile: null, hasProduct: false, hasConnectedChannel: false, hasPaymentMethods: false }).blockers)
      .toEqual(['channel_missing', 'catalog_missing', 'payment_methods_missing']);
  });
});
