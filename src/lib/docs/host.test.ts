import { describe, expect, it } from 'vitest';

import { docsRedirect, docsRewrite } from './host';

/**
 * Las dos direcciones del mismo camino. Importan juntas: si alguna vez se
 * solapan, el dominio del producto redirige al de documentación y ése vuelve a
 * redirigir, y el navegador corta el bucle con un error en vez de con la página.
 */
describe('docsRedirect', () => {
  it('manda la raíz de la documentación al subdominio', () => {
    expect(docsRedirect('/docs')).toBe('/');
    expect(docsRedirect('/documentacion')).toBe('/');
  });

  it('conserva la ruta interna', () => {
    expect(docsRedirect('/docs/mcp/oauth')).toBe('/mcp/oauth');
    expect(docsRedirect('/documentacion/mcp/oauth')).toBe('/mcp/oauth');
  });

  it('no toca lo que no es documentación', () => {
    for (const p of ['/', '/panel', '/api/mcp', '/documentacionista']) {
      expect(docsRedirect(p)).toBeNull();
    }
  });

  it('no se solapa con la reescritura del subdominio', () => {
    // Lo que docsRedirect produce es lo que el host de documentación recibe.
    // Si eso volviera a redirigir, el bucle sería infinito.
    for (const p of ['/docs', '/documentacion', '/docs/mcp', '/documentacion/mcp']) {
      const destino = docsRedirect(p);
      expect(destino).not.toBeNull();
      expect(docsRedirect(destino!)).toBeNull();
      // Y el subdominio sabe servirlo.
      expect(docsRewrite(destino!)).toMatch(/^\/documentacion/);
    }
  });
});
