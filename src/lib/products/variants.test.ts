import { describe, expect, it } from 'vitest';
import { formatShopifyVariants, shopifyCatalogVariants } from './variants';

const product = {
  status: 'active',
  published_at: '2026-09-08T22:51:03-04:00',
  options: [{ name: 'Modelo' }],
  variants: [
    {
      id: 1,
      title: 'Panda Blanco',
      option1: 'Panda Blanco',
      price: '110000.00',
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      inventory_quantity: 0,
    },
    {
      id: 2,
      title: 'Cerdita Rosa',
      option1: 'Cerdita Rosa',
      price: '110000.00',
      inventory_management: 'shopify',
      inventory_policy: 'continue',
      inventory_quantity: 0,
    },
    {
      id: 3,
      title: 'Color Niña',
      option1: 'Color Niña',
      price: '110000.00',
      inventory_management: null,
      inventory_policy: 'deny',
      inventory_quantity: 0,
    },
  ],
};

describe('variantes publicadas de Shopify', () => {
  it('distingue las variantes vendibles de las agotadas', () => {
    expect(shopifyCatalogVariants(product)).toEqual([
      expect.objectContaining({
        id: '1',
        title: 'Panda Blanco',
        available: false,
      }),
      expect.objectContaining({
        id: '2',
        title: 'Cerdita Rosa',
        available: true,
      }),
      expect.objectContaining({
        id: '3',
        title: 'Color Niña',
        available: true,
      }),
    ]);
  });

  it('explica al agente los nombres exactos de cada opción', () => {
    expect(formatShopifyVariants(product)).toBe(
      'Variantes disponibles: Modelo: Cerdita Rosa | Modelo: Color Niña. Variantes agotadas: Modelo: Panda Blanco'
    );
  });

  it('no expone variantes de productos no publicados', () => {
    expect(shopifyCatalogVariants({ ...product, published_at: null })).toEqual(
      []
    );
    expect(shopifyCatalogVariants({ ...product, status: 'draft' })).toEqual([]);
  });
});
