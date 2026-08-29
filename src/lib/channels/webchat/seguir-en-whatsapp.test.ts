import { describe, it, expect } from 'vitest';
import { codigoEnTexto } from './seguir-en-whatsapp';
import { datosPedidos, widgetSettings } from './config';
import type { WebchatConfig } from '@/types';

/**
 * El código que viaja por WhatsApp, y lo que el comercio decide pedir.
 *
 * Lo que se fija acá es la lectura, que es donde estas dos cosas se rompen sin
 * hacer ruido: un código mal reconocido no une nada y nadie se entera, y una
 * configuración vieja que se lee mal deja de pedir el correo que el comercio
 * había pedido.
 */

describe('el código del traspaso', () => {
  it('lo encuentra en un mensaje escrito por una persona', () => {
    expect(codigoEnTexto('Hola, vengo del chat de la web. [RZ-ABCDEFGHJK]')).toBe('ABCDEFGHJK');
  });

  it('no le importan las mayúsculas: la gente reescribe el mensaje', () => {
    expect(codigoEnTexto('hola [rz-abcdefghjk] gracias')).toBe('ABCDEFGHJK');
  });

  it('un mensaje normal no trae código', () => {
    expect(codigoEnTexto('Hola, quería saber si tienen talle M')).toBeNull();
    expect(codigoEnTexto('')).toBeNull();
    expect(codigoEnTexto(null)).toBeNull();
  });

  it('ignora lo que se le parece pero no lo es', () => {
    // Largo distinto, o con letras que el alfabeto excluye a propósito (O, I,
    // 0, 1 se confunden al tipear). Un falso positivo acá une dos fichas que no
    // son la misma persona.
    expect(codigoEnTexto('[RZ-ABC]')).toBeNull();
    expect(codigoEnTexto('[RZ-ABCDEFGHJKLM]')).toBeNull();
    expect(codigoEnTexto('[RZ-ABCDEFGHI0]')).toBeNull();
  });
});

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

describe('el botón de WhatsApp', () => {
  const base: WebchatConfig = { whatsapp_handoff: true };

  it('no se ofrece si el comercio no tiene WhatsApp conectado', () => {
    // Un botón que no lleva a ningún lado es peor que no tenerlo: la persona
    // se va del chat creyendo que sigue por otro lado y no sigue por ninguno.
    expect(widgetSettings(base, 'Tienda', { hasWhatsApp: false }).whatsapp_handoff).toBe(false);
  });

  it('se ofrece cuando el comercio lo activó y hay WhatsApp', () => {
    expect(widgetSettings(base, 'Tienda', { hasWhatsApp: true }).whatsapp_handoff).toBe(true);
  });

  it('no se ofrece si el comercio no lo activó, aunque tenga WhatsApp', () => {
    expect(widgetSettings({}, 'Tienda', { hasWhatsApp: true }).whatsapp_handoff).toBe(false);
  });
});
