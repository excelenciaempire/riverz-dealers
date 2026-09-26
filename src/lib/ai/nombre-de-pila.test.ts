import { describe, expect, it } from 'vitest';
import { primerNombre } from './nombre-de-pila';

describe('primerNombre', () => {
  it('saca el primer nombre y lo escribe bien', () => {
    expect(primerNombre('Carlos Gómez')).toBe('Carlos');
    expect(primerNombre('  maría josé ')).toBe('María');
    expect(primerNombre('JUAN PEREZ')).toBe('Juan');
    expect(primerNombre("D'Angelo")).toBe("D'angelo");
    expect(primerNombre('Iñaki')).toBe('Iñaki');
  });

  it('no saluda con nombres raros', () => {
    expect(primerNombre(null)).toBeNull();
    expect(primerNombre('')).toBeNull();
    expect(primerNombre('🌸✨')).toBeNull();
    expect(primerNombre('Carlos 🔥')).toBeNull();
    expect(primerNombre('Juan123')).toBeNull();
    expect(primerNombre('+54 9 11 5555')).toBeNull();
    expect(primerNombre('.')).toBeNull();
    expect(primerNombre('JP')).toBeNull();
    expect(primerNombre('Xkrt')).toBeNull();
    expect(primerNombre('Cliente')).toBeNull();
    expect(primerNombre('Ventas Distribuidora')).toBeNull();
    expect(primerNombre('Mamá')).toBeNull();
  });
});
