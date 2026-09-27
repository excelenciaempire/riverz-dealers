import { describe, it, expect } from 'vitest';
import { adminLegacyRedirect, adminRewrite, isAdminHost, isAdminInternalPath } from './host';
import {
  ADMIN_SECTION_LIST,
  ADMIN_SLUGS_RETIRADOS,
} from '@/app/admin/sections-list';

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

  it('mantiene los enlaces internos detrás del unlock y no del login del producto', () => {
    expect(isAdminInternalPath('admin.riverz.co', '/admin/comercios/abc')).toBe(true);
    expect(isAdminInternalPath('admin.riverz.co', '/comercios/abc')).toBe(false);
    expect(isAdminInternalPath('riverz.co', '/admin/comercios/abc')).toBe(false);
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

/**
 * Los slugs retirados no tenían ninguna red, y el fallo que cubren no se
 * parece a un fallo: `adminRewrite` manda al índice todo lo que no reconoce, así
 * que un enlace guardado a una sección que ya no existe **aterriza en el
 * índice** — que se lee como «funcionó». Un 404 se nota; esto no.
 */
describe('secciones retiradas', () => {
  it('cada slug retirado lleva a una sección que existe', () => {
    const vivos = new Set(
      ADMIN_SECTION_LIST.map((s) => s.href.replace(/^\/admin\//, '')),
    );
    for (const [viejo, nuevo] of Object.entries(ADMIN_SLUGS_RETIRADOS)) {
      expect(adminLegacyRedirect(`/${viejo}`)).toBe(`/${nuevo}`);
      // Un destino que ya no está en la lista redirige a un índice: el mismo
      // fallo silencioso, una vuelta más tarde.
      expect(vivos.has(nuevo)).toBe(true);
      // Y no puede seguir viva una sección con el nombre viejo, o la redirección
      // le robaría la suya.
      expect(vivos.has(viejo)).toBe(false);
    }
  });

  it('no redirige lo que sigue vivo ni lo que pasa de largo', () => {
    expect(adminLegacyRedirect('/comercios')).toBeNull();
    expect(adminLegacyRedirect('/')).toBeNull();
    expect(adminLegacyRedirect('/api/admin/unlock')).toBeNull();
  });
});
