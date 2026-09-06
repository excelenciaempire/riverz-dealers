import { describe, it, expect } from 'vitest';
import {
  detectProductByUrl,
  handleDeUrl,
  refersToCurrentPage,
  type CandidateProduct,
} from './product-routing';

/**
 * El producto sale de la página en la que está parado el visitante.
 *
 * Lo que se prueba acá no es el parser por el parser: es que la señal más
 * fuerte del chat web —"está mirando ESTA ficha"— llegue al agente. Sin esto,
 * quien pregunta "¿sirve para piel grasa?" parado en el serum recibía una
 * respuesta armada sin el conocimiento del serum.
 */

const CATALOGO: CandidateProduct[] = [
  {
    id: 'p1',
    title: 'Serum Vitamina C',
    handle: 'serum-vitamina-c',
    tags: null,
    vendor: null,
    product_type: null,
  },
  {
    id: 'p2',
    title: 'Crema Hidratante',
    handle: 'crema-hidratante',
    tags: null,
    vendor: null,
    product_type: null,
  },
];

describe('handleDeUrl', () => {
  it('saca el handle de las rutas de cada plataforma', () => {
    expect(handleDeUrl('https://mitienda.com/products/serum-vitamina-c')).toBe(
      'serum-vitamina-c',
    );
    expect(handleDeUrl('https://mitienda.com/productos/serum-vitamina-c')).toBe(
      'serum-vitamina-c',
    );
    expect(handleDeUrl('https://mitienda.com/producto/serum-vitamina-c')).toBe(
      'serum-vitamina-c',
    );
    expect(handleDeUrl('https://mitienda.com/p/serum-vitamina-c')).toBe('serum-vitamina-c');
  });

  it('aguanta colección, variante, extensión y mayúsculas', () => {
    expect(
      handleDeUrl('https://mitienda.com/collections/rostro/products/Serum-Vitamina-C?variant=42'),
    ).toBe('serum-vitamina-c');
    expect(handleDeUrl('https://mitienda.com/products/serum-vitamina-c.js')).toBe(
      'serum-vitamina-c',
    );
  });

  it('devuelve null donde no hay producto', () => {
    expect(handleDeUrl('https://mitienda.com/')).toBeNull();
    expect(handleDeUrl('https://mitienda.com/collections/rostro')).toBeNull();
    expect(handleDeUrl(null)).toBeNull();
    expect(handleDeUrl('')).toBeNull();
  });
});

describe('detectProductByUrl', () => {
  it('encuentra el producto de la ficha y lo marca como certeza alta', () => {
    const m = detectProductByUrl('https://mitienda.com/products/crema-hidratante', CATALOGO);
    expect(m?.product_id).toBe('p2');
    expect(m?.confidence).toBe('high');
    expect(m?.via).toBe('page_url');
  });

  it('no inventa un producto cuando el handle no está en el catálogo', () => {
    expect(detectProductByUrl('https://mitienda.com/products/otra-cosa', CATALOGO)).toBeNull();
  });

  it('una página que no es de producto no matchea nada', () => {
    expect(detectProductByUrl('https://mitienda.com/pages/envios', CATALOGO)).toBeNull();
  });
});

describe('refersToCurrentPage', () => {
  it('reconoce referencias a la ficha en español e inglés', () => {
    expect(refersToCurrentPage('Quiero comprar este Serum Pilar')).toBe(true);
    expect(refersToCurrentPage('Quiero el producto que estoy viendo')).toBe(true);
    expect(refersToCurrentPage('Can I buy this product?')).toBe(true);
  });

  it('no convierte el nombre de otro producto en una referencia a la ficha', () => {
    expect(refersToCurrentPage('Quiero comprar la crema hidratante')).toBe(false);
  });
});
