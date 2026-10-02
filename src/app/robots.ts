import type { MetadataRoute } from 'next';

// Public marketing + legal + auth pages stay crawlable; the private
// dashboard (route group `(dashboard)`, served at the app root — e.g.
// `/panel`, `/bandeja`) and all API/internal paths are disallowed so
// authenticated, per-tenant surfaces never leak into search results.
const DISALLOW = [
  '/api/',
  '/auth/',
  '/admin',
  '/panel',
  '/concesionario',
  '/dealer',
  '/bandeja',
  '/contactos',
  '/productos',
  '/asistente',
  '/agente-instagram',
  '/automatizaciones',
  '/campanas',
  '/plantillas',
  '/menus',
  '/integraciones',
  '/ajustes',
];

export default function robots(): MetadataRoute.Robots {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: DISALLOW,
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
