import { describe, it, expect } from 'vitest';
import type { Contact } from '@/types';
import {
  esCasillaDeRol,
  esTelefonoDeRelleno,
  hayContradiccion,
  identificadoresParaUnir,
  sirveParaUnir,
} from './identidad-probada';

/**
 * La regla es una: ante la duda, no se une.
 *
 * Unir de más le muestra a una persona la dirección, el teléfono y los pedidos
 * de otra. Unir de menos sólo hace que el agente pregunte algo que ya sabía. No
 * son igual de graves, y estas pruebas fijan de qué lado se cae.
 */

const ficha = (extra: Record<string, unknown>) =>
  ({ id: 'c1', workspace_id: 'w1', channel: 'whatsapp', ...extra }) as unknown as Contact;

describe('de dónde salió el dato', () => {
  it('sólo une lo respaldado', () => {
    for (const ok of ['canal', 'pedido', 'tienda', 'pago', 'manual']) {
      expect(sirveParaUnir(ok)).toBe(true);
    }
    expect(sirveParaUnir('afirmado')).toBe(false);
  });

  it('lo anterior a la migración se hereda: NULL sigue uniendo', () => {
    // Romper las uniones viejas de golpe partiría clientes que hoy se ven bien.
    expect(sirveParaUnir(null)).toBe(true);
  });

  it('un correo tipeado en un chat no une a nadie', () => {
    const c = ficha({ email: 'ana@mail.com', email_origen: 'afirmado' });
    expect(identificadoresParaUnir(c).email).toBeNull();
  });

  it('el mismo correo, si vino de un pedido, sí une', () => {
    const c = ficha({ email: 'ana@mail.com', email_origen: 'pedido' });
    expect(identificadoresParaUnir(c).email).toBe('ana@mail.com');
  });
});

describe('datos que no identifican a nadie', () => {
  it('las casillas de rol quedan afuera', () => {
    // La casilla del propio comercio aparece en decenas de fichas: unir por
    // ahí funde a todos los clientes en uno solo, sin vuelta atrás.
    for (const c of ['info@tienda.com', 'ventas@x.com', 'no-reply@y.com', 'soporte@z.io']) {
      expect(esCasillaDeRol(c)).toBe(true);
    }
    expect(esCasillaDeRol('ana.gomez@gmail.com')).toBe(false);
  });

  it('los teléfonos de relleno quedan afuera', () => {
    for (const t of ['0000000000', '1111111111', '1234567890', '123']) {
      expect(esTelefonoDeRelleno(t)).toBe(true);
    }
    expect(esTelefonoDeRelleno('+54 9 11 3333-4444')).toBe(false);
  });
});

describe('ante la duda, no se une', () => {
  it('mismo teléfono y correos distintos es un teléfono de familia', () => {
    expect(
      hayContradiccion([
        { id: 'a', phone: '+5491133334444', email: 'ana@mail.com' },
        { id: 'b', phone: '+5491133334444', email: 'jose@mail.com' },
      ]),
    ).toBe(true);
  });

  it('un dato que falta en una ficha NO es contradicción', () => {
    // Es justamente lo que la unión viene a completar.
    expect(
      hayContradiccion([
        { id: 'a', phone: '+5491133334444', email: 'ana@mail.com' },
        { id: 'b', phone: '+5491133334444', email: null },
      ]),
    ).toBe(false);
  });

  it('una separación hecha a mano gana sobre cualquier coincidencia', () => {
    const c = ficha({
      phone: '+5491133334444',
      phone_origen: 'canal',
      union_bloqueada: true,
    });
    expect(identificadoresParaUnir(c)).toEqual({ phone: null, email: null });
  });
});
