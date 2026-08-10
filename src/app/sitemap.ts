import type { MetadataRoute } from "next";
import { signupsOpen } from "@/lib/auth/signups";

const BASE_URL = "https://riverz.co";

// Only public, crawlable routes belong here. The private dashboard and
// API live behind auth and are excluded (see robots.ts).
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
    // /registro only while sign-ups are open — no point sending crawlers
    // to a page the proxy redirects to the landing.
    ...(signupsOpen()
      ? [
          {
            url: `${BASE_URL}/registro`,
            lastModified,
            changeFrequency: "monthly" as const,
            priority: 0.7,
          },
        ]
      : []),
    {
      url: `${BASE_URL}/terminos`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
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
