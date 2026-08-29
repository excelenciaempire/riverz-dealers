import { describe, it, expect } from 'vitest';
import { datosPedidos } from './config';

/**
 * Lo que el comercio decide pedirle al visitante antes de que escriba.
 *
 * Se fija la LECTURA, que es donde esto se rompe sin hacer ruido: una
 * configuración vieja mal leída deja de pedir el correo que el comercio pidió.
 */

describe('qué se le pide al visitante', () => {
  it('lo nuevo manda', () => {
    expect(datosPedidos({ require_contact: 'both' })).toBe('both');
    expect(datosPedidos({ require_contact: 'phone' })).toBe('phone');
    expect(datosPedidos({ require_contact: 'off' })).toBe('off');
  });

  it('una configuración vieja sigue pidiendo el correo', () => {
    // El ajuste era un sí/no. Las configuraciones ya guardadas no tienen
    // `require_contact`, y leerlas mal es dejar de pedir algo que el comercio
    // configuró.
    expect(datosPedidos({ require_email: true })).toBe('email');
    expect(datosPedidos({ require_email: false })).toBe('off');
    expect(datosPedidos({})).toBe('off');
  });

  it('lo nuevo le gana al booleano viejo cuando se contradicen', () => {
    expect(datosPedidos({ require_email: true, require_contact: 'off' })).toBe('off');
    expect(datosPedidos({ require_email: false, require_contact: 'phone' })).toBe('phone');
  });
});
