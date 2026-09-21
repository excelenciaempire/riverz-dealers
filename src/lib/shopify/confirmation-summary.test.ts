import { describe, expect, it } from 'vitest';
import { confirmationSummary } from './confirmation-summary';

describe('confirmationSummary', () => {
  it('includes every product, variant, quantity and delivery field', () => {
    expect(
      confirmationSummary({
        line_items: [
          { title: 'Saltarín', variant_title: 'Rana', quantity: 2 },
          {
            title: 'Otro producto',
            variant_title: 'Default Title',
            quantity: 1,
          },
        ],
        shipping_address: {
          first_name: 'Ana',
          last_name: 'Pérez',
          address1: 'Calle 1',
          address2: 'Apto 2',
          city: 'Cali',
          province: 'Valle',
          phone: '+573000000000',
        },
      })
    ).toEqual({
      order_items: '2 × Saltarín (Rana)\n1 × Otro producto',
      delivery_address: 'Calle 1, Apto 2, Cali, Valle',
      delivery_phone: '+573000000000',
      recipient_name: 'Ana Pérez',
    });
  });
  it('does not invent missing customer data or emit empty Meta parameters', () => {
    expect(confirmationSummary({})).toEqual({
      order_items: '—',
      delivery_address: '—',
      delivery_phone: '—',
      recipient_name: '—',
    });
  });

  it('incluye las opciones públicas elegidas por el cliente', () => {
    expect(
      confirmationSummary({
        line_items: [
          {
            title: 'Pelota saltarina LED Juego',
            variant_title: 'Default Title',
            quantity: 1,
            properties: [
              { name: 'Modelo', value: 'Color Niña' },
              { name: '_bundle_id', value: 'interno' },
            ],
          },
        ],
      }).order_items
    ).toBe('1 × Pelota saltarina LED Juego (Modelo: Color Niña)');
  });

  it('muestra varias opciones de una variante compuesta', () => {
    expect(
      confirmationSummary({
        line_items: [
          {
            title: 'Camiseta',
            variant_title: 'Negro / XL',
            quantity: 2,
          },
        ],
      }).order_items
    ).toBe('2 × Camiseta (Negro / XL)');
  });

  it('recupera la variante del nombre si Shopify omite variant_title', () => {
    expect(
      confirmationSummary({
        line_items: [
          {
            title: 'Pelota saltarina LED Juego',
            name: 'Pelota saltarina LED Juego - Cerdita Rosa',
            variant_title: null,
            quantity: 1,
          },
        ],
      }).order_items
    ).toBe('1 × Pelota saltarina LED Juego (Cerdita Rosa)');
  });

  it('acepta propiedades con key y conserva varios diseños de un combo', () => {
    expect(
      confirmationSummary({
        line_items: [
          {
            title: 'Combo 2 unidades',
            name: 'Combo 2 unidades - Default Title',
            quantity: null,
            properties: [
              { key: 'Diseño 1', value: 'Cerdita Rosa' },
              { key: 'Diseño 2', value: 'Rana Verde' },
              { key: '_bundle_id', value: 'interno' },
            ],
          },
        ],
      }).order_items
    ).toBe(
      '1 × Combo 2 unidades (Diseño 1: Cerdita Rosa, Diseño 2: Rana Verde)'
    );
  });
  it('removes newlines and tabs from Meta parameter values', () => {
    expect(
      confirmationSummary({
        shipping_address: { name: 'Ana\nPérez', address1: 'Calle\t1' },
        phone: '+573000000000',
      })
    ).toMatchObject({
      recipient_name: 'Ana Pérez',
      delivery_address: 'Calle 1',
      delivery_phone: '+573000000000',
    });
  });
});
