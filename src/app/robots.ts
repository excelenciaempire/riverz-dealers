import type { MetadataRoute } from "next";

// Public marketing + legal + auth pages stay crawlable; the private
// dashboard (route group `(dashboard)`, served at the app root — e.g.
// `/panel`, `/bandeja`) and all API/internal paths are disallowed so
// authenticated, per-tenant surfaces never leak into search results.
const DISALLOW = [
  "/api/",
  "/auth/",
  "/admin",
  "/panel",
  "/bandeja",
  "/contactos",
  "/productos",
  "/asistente",
  "/agente-instagram",
  "/automatizaciones",
  "/campanas",
  "/plantillas",
  "/menus",
  "/metricas",
  "/integraciones",
  "/ajustes",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOW,
    },
    sitemap: "https://riverz.co/sitemap.xml",
    host: "https://riverz.co",
  };
}
