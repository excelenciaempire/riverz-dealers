import type { MetadataRoute } from "next";

const BASE_URL = "https://riverz.co";

// Only public, crawlable routes belong here. The private dashboard and
// API live behind auth and are excluded (see robots.ts). Note: a
// `/terminos` page does not exist yet, so it is intentionally omitted —
// a sitemap entry that 404s hurts crawl trust. Add it here once the
// route ships.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: BASE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/ingresar`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/registro`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/privacidad`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/eliminar-datos`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
