import { describe, expect, it } from 'vitest';
import { pickProduct } from './product-brain';

const products = [
  { title: 'Referencia No. 4', handle: 'ref-4' },
  { title: 'RasmiTower', handle: 'rasmitower' },
];

describe('producto mencionado por una publicación', () => {
  it('reconoce una referencia corta por el handle', () => {
    expect(
      pickProduct(products, 'Tu gato feliz. Ref 4 ¡Compra YA!')?.title
    ).toBe('Referencia No. 4');
  });

  it('reconoce la forma larga de la referencia', () => {
    expect(pickProduct(products, 'Quiero la referencia número 4')?.title).toBe(
      'Referencia No. 4'
    );
  });

  it('no asigna un producto cuando el post no lo identifica', () => {
    expect(pickProduct(products, 'Mi gato está jugando en casa')).toBeNull();
  });
});
