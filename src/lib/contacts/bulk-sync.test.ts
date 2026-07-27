import { describe, it, expect } from 'vitest';
import type { Contact } from '@/types';
import { __testing } from './bulk-sync';

const { nextPageUrl, lookup } = __testing;

describe('nextPageUrl', () => {
  it('saca la URL de la página siguiente del header Link', () => {
    const link =
      '<https://x.myshopify.com/admin/api/2024-10/customers.json?page_info=AAA>; rel="next"';
    expect(nextPageUrl(link)).toBe(
      'https://x.myshopify.com/admin/api/2024-10/customers.json?page_info=AAA',
    );
  });

  it('ignora la página anterior y toma sólo la siguiente', () => {
    const link =
      '<https://x/prev>; rel="previous", <https://x/next>; rel="next"';
    expect(nextPageUrl(link)).toBe('https://x/next');
  });

  it('devuelve null en la última página (sólo rel=previous) y sin header', () => {
    expect(nextPageUrl('<https://x/prev>; rel="previous"')).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});

function index() {
  const cliente = { id: 1, email: 'ANA@mail.com', phone: '+543472500967' };
  return {
    byEmail: new Map([['ana@mail.com', cliente]]),
    byPhone: new Map([['72500967', cliente]]),
    size: 1,
  } as Parameters<typeof lookup>[0];
}

const contacto = (c: Partial<Contact>) => c as Contact;

describe('lookup', () => {
  it('empareja por email sin importar mayúsculas', () => {
    expect(lookup(index(), contacto({ email: 'Ana@Mail.com' }))?.id).toBe(1);
  });

  it('empareja el móvil argentino con 9 contra el de Shopify sin 9', () => {
    expect(lookup(index(), contacto({ phone: '5493472500967' }))?.id).toBe(1);
  });

  it('no inventa un match cuando la persona no está en la tienda', () => {
    expect(lookup(index(), contacto({ email: 'otro@mail.com', phone: '5491100000000' }))).toBeNull();
  });

  it('no empareja con un teléfono demasiado corto para ser confiable', () => {
    expect(lookup(index(), contacto({ phone: '5967' }))).toBeNull();
  });
});
