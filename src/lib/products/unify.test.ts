import { describe, it, expect } from 'vitest';
import {
  elegirPrincipal,
  normalizarTitulo,
  parecido,
  skuDe,
  tokensSignificativos,
  UMBRAL,
  type FilaProducto,
} from './unify';

/**
 * Emparejar de más es peor que emparejar de menos.
 *
 * Si dos productos distintos quedan unidos, el agente cotiza el precio del
 * equivocado y contesta con el conocimiento del equivocado. Eso es peor que el
 * problema que esto resuelve, así que estas pruebas tiran sobre todo del lado
 * de los falsos positivos.
 *
 * Los títulos son reales: el serum de Pilar en Shopify y sus tres
 * publicaciones de Mercado Libre, más la bicicleta que está en la misma cuenta
 * de Mercado Libre y NO tiene nada que ver.
 */

const SHOPIFY = 'Serum Pilar';
const ML1 = 'Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml Todo Tipo De Piel Día/noche';
const ML2 = 'Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml X2 Todo Tipo De Piel Día/noche';
const ML3 = 'Pilar Serum Reafirmante Antiedad Regeneracion 30 Ml X3 Todo Tipo De Piel Día/noche';
const BICI = 'Bicicleta Mountain Bike Silverfox Mtb Hardtail Fm18si29am211 2021 Color Negro';

describe('parecido de títulos', () => {
  it('reconoce el mismo producto entre Shopify y Mercado Libre', () => {
    // El marketplace rellena el título con palabras clave. Comparando de forma
    // simétrica esto daba 0,2 y no emparejaba nunca.
    expect(parecido(SHOPIFY, ML1)).toBeGreaterThanOrEqual(UMBRAL);
  });

  it('x1, x2 y x3 son el mismo producto', () => {
    // Las cantidades son presentación, no producto: si no, el comercio termina
    // cargando el mismo conocimiento tres veces.
    expect(parecido(ML1, ML2)).toBeGreaterThanOrEqual(UMBRAL);
    expect(parecido(ML2, ML3)).toBeGreaterThanOrEqual(UMBRAL);
    expect(parecido(SHOPIFY, ML3)).toBeGreaterThanOrEqual(UMBRAL);
  });

  it('NO empareja la bicicleta con el serum', () => {
    for (const t of [SHOPIFY, ML1, ML2, ML3]) {
      expect(parecido(BICI, t), t).toBeLessThan(UMBRAL);
    }
  });

  it('NO empareja dos productos distintos de la misma marca', () => {
    // El caso caro: misma marca, misma línea, producto distinto.
    expect(parecido('Serum Vitamina C 30ml', 'Serum Acido Hialuronico 30ml')).toBeLessThan(UMBRAL);
    expect(parecido('Aria Vitamin C Serum 30ml', 'Aria Mineral Sunscreen SPF 50')).toBeLessThan(
      UMBRAL,
    );
  });

  it('una sola palabra en común nunca alcanza', () => {
    // "Serum" solo emparejaría todos los serums del catálogo.
    expect(parecido('Serum', 'Serum Pilar')).toBe(0);
    expect(parecido('Crema', 'Crema Hidratante Facial')).toBe(0);
  });

  it('no se pelea con tildes, mayúsculas ni signos', () => {
    expect(normalizarTitulo('Día/noche — ¡NUEVO!')).toBe('dia noche nuevo');
    expect(parecido('Serum Pilar', 'SÉRUM PILÁR')).toBeGreaterThanOrEqual(UMBRAL);
  });

  it('descarta la presentación al mirar las palabras', () => {
    const t = tokensSignificativos(ML2);
    expect(t.has('serum')).toBe(true);
    expect(t.has('pilar')).toBe(true);
    for (const ruido of ['30', 'x2', 'ml', 'todo', 'tipo']) {
      expect(t.has(ruido), ruido).toBe(false);
    }
  });
});

describe('skuDe', () => {
  const fila = (raw: unknown): FilaProducto =>
    ({ id: 'x', title: 't', platform: 'shopify', raw }) as FilaProducto;

  it('lo encuentra donde lo pone cada plataforma', () => {
    expect(skuDe(fila({ variants: [{ sku: 'PF-FC-SERUM-PILAR' }] }))).toBe('PF-FC-SERUM-PILAR');
    expect(skuDe(fila({ sku: 'abc-123' }))).toBe('ABC-123');
    expect(skuDe(fila({ seller_custom_field: 'ml-999' }))).toBe('ML-999');
    expect(skuDe(fila({ variants: [{ barcode: '7791234567890' }] }))).toBe('7791234567890');
  });

  it('ignora lo que no identifica nada', () => {
    // Un SKU de dos caracteres aparece repetido en medio catálogo.
    expect(skuDe(fila({ variants: [{ sku: 'A1' }] }))).toBeNull();
    expect(skuDe(fila({ variants: [{ sku: '' }] }))).toBeNull();
    expect(skuDe(fila({}))).toBeNull();
    expect(skuDe(fila(null))).toBeNull();
  });
});

describe('elegirPrincipal', () => {
  const p = (over: Partial<FilaProducto>): FilaProducto =>
    ({ id: 'i', title: 't', platform: 'shopify', training_material: '', ...over }) as FilaProducto;

  it('gana la que tiene el conocimiento cargado', () => {
    const elegida = elegirPrincipal([
      p({ id: 'ml', platform: 'mercadolibre', training_material: '' }),
      p({ id: 'shop', platform: 'shopify', training_material: 'x'.repeat(10_000) }),
    ]);
    expect(elegida.id).toBe('shop');
  });

  it('con empate gana la tienda propia sobre el marketplace', () => {
    // Ahí el comercio controla la ficha, la página se puede leer y el precio
    // no tiene comisiones encima.
    const elegida = elegirPrincipal([
      p({ id: 'ml', platform: 'mercadolibre' }),
      p({ id: 'tn', platform: 'tiendanube' }),
    ]);
    expect(elegida.id).toBe('tn');
  });
});
