import { describe, expect, it } from 'vitest';
import { interpolateVoiceGreeting } from './context';

describe('interpolateVoiceGreeting', () => {
  it('inserta sólo los datos disponibles', () => {
    expect(
      interpolateVoiceGreeting(
        'Hola{{contact_name}}, tu pedido {{order_number}} llega a {{shipping_city}}.',
        {
          contact_name: 'María Fernanda',
          order_number: '#1042',
          shipping_city: 'Medellín',
        }
      )
    ).toBe('Hola María, tu pedido #1042 llega a Medellín.');
  });

  it('omite variables ausentes sin leer el marcador ni dejar espacios extra', () => {
    expect(
      interpolateVoiceGreeting(
        'Hola{{contact_name}}, te llamo de {{business_name}}. Pedido {{order_number}}.',
        { contact_name: '', business_name: 'Riverz' }
      )
    ).toBe('Hola, te llamo de Riverz. Pedido.');
  });

  it('omite marcadores no reconocidos para no inventar datos', () => {
    expect(interpolateVoiceGreeting('Hola {{dato_privado}}.', {})).toBe(
      'Hola.'
    );
  });
});
