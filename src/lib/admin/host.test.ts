import { describe, it, expect } from 'vitest';
import { adminRewrite, isAdminHost } from './host';
import { ADMIN_SECTION_LIST } from '@/app/admin/sections-list';

/**
 * El ruteo por host se rompe en silencio: no falla ningún test de producto,
 * simplemente el equipo aterriza en un 404 y no sabe por qué. Pasó al probarlo
 * en vivo — después de entrar, el login manda a `/panel` y eso terminaba
 * reescrito a `/admin/panel`, que no existe.
 */
describe('host del panel', () => {
  it('reconoce el host, con y sin puerto', () => {
    expect(isAdminHost('admin.riverz.co')).toBe(true);
    expect(isAdminHost('ADMIN.riverz.co:443')).toBe(true);
    expect(isAdminHost('riverz.co')).toBe(false);
    expect(isAdminHost('www.riverz.co')).toBe(false);
    expect(isAdminHost(null)).toBe(false);
  });

  it('la raíz es el panel', () => {
    expect(adminRewrite('/')).toBe('/admin');
  });

  it('lleva las secciones a su ruta interna', () => {
    expect(adminRewrite('/ia')).toBe('/admin/ia');
    expect(adminRewrite('/whatsapp')).toBe('/admin/whatsapp');
    expect(adminRewrite('/comercios/123')).toBe('/admin/comercios/123');
  });

  it('lo que no es del panel cae en su home, no en un 404', () => {
    expect(adminRewrite('/panel')).toBe('/admin');
    expect(adminRewrite('/bandeja')).toBe('/admin');
    expect(adminRewrite('/cualquier-cosa')).toBe('/admin');
  });

  it('no toca lo que tiene que pasar de largo', () => {
    expect(adminRewrite('/api/admin/unlock')).toBeNull();
    expect(adminRewrite('/ingresar')).toBeNull();
    expect(adminRewrite('/_next/static/x.js')).toBeNull();
    expect(adminRewrite('/admin')).toBeNull();
    expect(adminRewrite('/admin/ia')).toBeNull();
  });

  it('conoce TODAS las secciones del panel, no una copia a mano', () => {
    // La regresión que esto fija: la lista de slugs vivía duplicada en host.ts,
    // así que una sección nueva agregada sólo en sections.ts caía al home en
    // admin.riverz.co sin que nada fallara.
    for (const section of ADMIN_SECTION_LIST) {
      const slug = section.href.replace(/^\/admin\//, '');
      expect(adminRewrite(`/${slug}`)).toBe(section.href);
    }
  });

  it('una sub-ruta de una sección también reescribe', () => {
    expect(adminRewrite('/comercios/a1b2c3d4')).toBe('/admin/comercios/a1b2c3d4');
  });
});
