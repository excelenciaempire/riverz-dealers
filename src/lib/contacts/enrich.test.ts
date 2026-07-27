import { describe, it, expect } from 'vitest';
import { __testing } from './enrich';

const { phoneQueryVariants } = __testing;

describe('phoneQueryVariants', () => {
  it('cubre el 9 de móvil argentino en las dos direcciones', () => {
    // Guardado como WhatsApp lo exige (con 9) → también busca sin el 9.
    expect(phoneQueryVariants('5493472500967')).toContain('543472500967');
    // Guardado como suele estar en Shopify (sin 9) → también busca con el 9.
    expect(phoneQueryVariants('543472500967')).toContain('5493472500967');
  });

  it('prueba con y sin el "+" que Shopify usa al guardar', () => {
    const v = phoneQueryVariants('543472500967');
    expect(v).toContain('543472500967');
    expect(v).toContain('+543472500967');
  });

  it('incluye la variante con 0 de trunk', () => {
    expect(phoneQueryVariants('5491112345678')).toContain('54091112345678');
  });

  it('descarta lo que es demasiado corto para ser un teléfono', () => {
    expect(phoneQueryVariants('12345')).toEqual([]);
    expect(phoneQueryVariants('')).toEqual([]);
  });

  it('no repite variantes', () => {
    const v = phoneQueryVariants('543472500967');
    expect(new Set(v).size).toBe(v.length);
  });
});
