import { describe, it, expect } from 'vitest';
import { formatProductLine, unificarFilas, type ProductRow } from './runner';

/**
 * Un producto vendido en varios lados, tal como lo ve el modelo.
 *
 * El caso real: el serum de Pilar vive en Shopify (COP, con las ofertas del
 * combo) y en tres publicaciones de Mercado Libre (ARS, una por cantidad). Lo
 * que no puede pasar nunca es que el agente cotice pesos argentinos a alguien
 * que compra en pesos colombianos.
 */

const fila = (o: Partial<ProductRow>): ProductRow =>
  ({
    id: o.id ?? 'x',
    title: o.title ?? 'Serum Pilar',
    description: null,
    price_min: null,
    price_max: null,
    url: null,
    product_type: null,
    vendor: null,
    tags: null,
    ...o,
  }) as ProductRow;

const MAESTRO = fila({
  id: 'shop',
  title: 'Serum Pilar',
  platform: 'shopify',
  price_min: 39990,
  currency: 'COP',
  training_material: 'todo el conocimiento del serum',
});
const ML1 = fila({
  id: 'ml1',
  title:
    'Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml Todo Tipo De Piel Día/noche',
  platform: 'mercadolibre',
  price_min: 45000,
  currency: 'ARS',
  master_id: 'shop',
});
const ML2 = fila({
  id: 'ml2',
  title:
    'Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml X2 Todo Tipo De Piel Día/noche',
  platform: 'mercadolibre',
  price_min: 75000,
  currency: 'ARS',
  master_id: 'shop',
});

describe('unificarFilas', () => {
  it('el modelo ve UN producto, no cuatro', () => {
    const out = unificarFilas([MAESTRO, ML1, ML2]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('shop');
  });

  it('el conocimiento sale de la principal', () => {
    // Es el punto de todo: se carga una vez y vale para todos los canales.
    const out = unificarFilas([MAESTRO, ML1, ML2]);
    expect(out[0].training_material).toContain('conocimiento del serum');
  });

  it('cada canal conserva su precio y su cantidad', () => {
    const out = unificarFilas([MAESTRO, ML1, ML2]);
    const l = out[0].listings ?? [];
    expect(l).toHaveLength(3);
    expect(l.find((x) => x.price === 75000)?.units).toBe(2);
    expect(l.find((x) => x.price === 45000)?.units).toBe(1);
  });

  it('una publicación cuya principal no vino se queda sola', () => {
    // Plegarla contra algo que no está cargado la dejaría sin conocimiento y
    // sin fila propia, o sea invisible para el agente.
    const out = unificarFilas([ML1]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ml1');
  });

  it('no toca lo que no está unificado', () => {
    const bici = fila({
      id: 'bici',
      title: 'Bicicleta',
      platform: 'mercadolibre',
    });
    const out = unificarFilas([MAESTRO, ML1, bici]);
    expect(out.map((p) => p.id).sort()).toEqual(['bici', 'shop']);
  });
});

describe('lo que se le muestra al modelo', () => {
  it('lista el precio de cada canal, con su moneda y su cantidad', () => {
    const [uno] = unificarFilas([MAESTRO, ML1, ML2]);
    const linea = formatProductLine(uno);
    expect(linea).toContain('39990 COP');
    expect(linea).toContain('45000 ARS');
    expect(linea).toContain('2u 75000 ARS');
  });

  it('sin monedas completas NO muestra precios', () => {
    // Un "$39990" al lado de "$45000 ARS" se lee como el mismo orden de
    // magnitud, y ahí el modelo cotiza pesos argentinos a un cliente
    // colombiano. Que le falte un precio es recuperable; que diga el
    // equivocado, no.
    const sinMoneda = { ...MAESTRO, currency: null };
    const [uno] = unificarFilas([sinMoneda, ML1]);
    const linea = formatProductLine(uno);
    expect(linea).not.toContain('45000');
    expect(linea).toContain('mercadolibre');
    expect(linea).toContain('consultalo antes de cotizar');
  });

  it('un producto de un solo canal se ve como siempre', () => {
    const linea = formatProductLine(MAESTRO);
    expect(linea).not.toContain('precio por canal');
    expect(linea).not.toContain('también se vende');
  });

  it('incluye cada variante publicada y distingue las agotadas', () => {
    const linea = formatProductLine(
      fila({
        id: 'pelota',
        title: 'Pelota saltarina LED Juego',
        platform: 'shopify',
        raw: {
          status: 'active',
          published_at: '2026-09-08T22:51:03-04:00',
          options: [{ name: 'Modelo' }],
          variants: [
            {
              id: 1,
              title: 'Color Niña',
              option1: 'Color Niña',
              inventory_management: 'shopify',
              inventory_policy: 'continue',
              inventory_quantity: 0,
            },
            {
              id: 2,
              title: 'Panda Blanco',
              option1: 'Panda Blanco',
              inventory_management: 'shopify',
              inventory_policy: 'deny',
              inventory_quantity: 0,
            },
          ],
        },
      })
    );
    expect(linea).toContain('Variantes disponibles: Modelo: Color Niña');
    expect(linea).toContain('Variantes agotadas: Modelo: Panda Blanco');
  });
});
