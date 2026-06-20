import type { MetadataRoute } from "next";

// Web app manifest — sets the installed-app name, share/PWA metadata and the
// Android toolbar color. Next serves this at /manifest.webmanifest and injects
// <link rel="manifest">. Icons reuse the generated brand routes (icon.tsx /
// apple-icon.tsx). Colors mirror the brand dark surface (globals.css #0a0a0a).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "riverz — Agente de IA para WhatsApp e Instagram",
    short_name: "riverz",
    description:
      "El agente de IA que atiende, recomienda y cierra ventas por WhatsApp e Instagram. Recupera carritos y vende 24/7.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "es",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
