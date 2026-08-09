import type { Metadata, Viewport } from "next";
import { Inter_Tight } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { LocaleProvider } from "@/hooks/use-locale";
import { getLocale } from "@/lib/i18n/server";
import {
  DEFAULT_LANDING_THEME,
  DEFAULT_THEME,
  LANDING_PATHS,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

// Force dynamic rendering per-request so the CSP nonce minted by the
// proxy (forwarded via the x-nonce header) is available to inject into
// the streaming inline theme-boot script below.
export const dynamic = "force-dynamic";

// Inter Tight is Riverz's editorial typeface — used app-wide. The
// negative tracking and lighter weights give the "expensive" feel of
// the Riverz design system.
const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://riverz.co"),
  title: {
    default: "riverz",
    template: "%s · riverz",
  },
  description:
    "riverz despliega agentes de IA que atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas: recomiendan, recuperan carritos y crean el pedido en tu tienda, 24/7.",
  applicationName: "riverz",
  authors: [{ name: "riverz", url: "https://riverz.co" }],
  creator: "riverz",
  publisher: "riverz",
  category: "business",
  keywords: [
    "agentes de IA para ventas",
    "agente de IA autónomo",
    "IA agéntica para ecommerce",
    "CRM con IA",
    "CRM para WhatsApp",
    "CRM para Instagram",
    "agente para Mercado Libre",
    "responder preguntas de Mercado Libre",
    "bandeja multicanal",
    "agente de voz para llamadas",
    "chatbot de ventas WhatsApp",
    "automatización de WhatsApp",
    "recuperación de carritos",
    "bandeja unificada",
    "atención al cliente con IA",
    "WhatsApp Business",
    "vender por Instagram",
  ],
  // The public marketing surface (landing + legal + auth) must be
  // indexable; per-route metadata still wins, so the private dashboard
  // can opt out of indexing on its own segments if needed.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // og:image / twitter:image are auto-injected from the site-wide
  // opengraph-image.tsx and twitter-image.tsx file conventions — no need to
  // declare images here.
  openGraph: {
    type: "website",
    siteName: "riverz",
    title: "riverz — Agentes de IA que venden en todos tus canales",
    description:
      "Atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas: recomiendan, recuperan carritos y crean el pedido.",
    url: "/",
    locale: "es_ES",
  },
  twitter: {
    card: "summary_large_image",
    title: "riverz — Agentes de IA que venden en todos tus canales",
    description:
      "Atienden, deciden y ejecutan en WhatsApp, Instagram, Messenger, Mercado Libre, correo y llamadas: recomiendan, recuperan carritos y crean el pedido.",
  },
  alternates: {
    canonical: "/",
  },
  appleWebApp: {
    capable: true,
    title: "riverz",
    statusBarStyle: "default",
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
};

// Inline boot script — runs before React hydrates so the right theme is on
// the <html> element before first paint. Without this every landing load would
// flash the app's light default for a frame before React mounts and corrects
// it to dark.
//
// Theme is ONE shared preference (STORAGE_KEY). An explicit saved choice wins
// on every surface. Only when there is no saved choice does the *default*
// depend on the surface: the marketing landing (LANDING_PATHS) defaults to the
// dark editorial look, the app/auth/legal default to light. This keeps the
// landing dark-first and the app light-first while a single toggle still flips
// both once the visitor picks.
//
// Kept dependency-free (no imports, no JSX) — must be a string the browser can
// run as a single <script>. Valid IDs / defaults / marketing paths are sourced
// from the shared constants so they can't drift from the rest of the app.
const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var STORAGE_KEY = ${JSON.stringify(STORAGE_KEY)};
    var APP_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var LANDING_DEFAULT = ${JSON.stringify(DEFAULT_LANDING_THEME)};
    var LANDING_PATHS = ${JSON.stringify(LANDING_PATHS)};
    var ALLOWED = ${JSON.stringify(THEME_IDS)};
    var saved = localStorage.getItem(STORAGE_KEY);
    var theme;
    if (ALLOWED.indexOf(saved) !== -1) {
      // Explicit, shared choice — applies to every surface.
      theme = saved;
    } else {
      // No choice yet: dark-first on the landing, light-first everywhere else.
      var path = location.pathname;
      theme = LANDING_PATHS.indexOf(path) !== -1 ? LANDING_DEFAULT : APP_DEFAULT;
    }
    document.documentElement.dataset.theme = theme;
  } catch (_e) {
    document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The nonce is minted per-request in proxy.ts and forwarded via the
  // x-nonce request header. CSP blocks any inline <script> without it,
  // so the theme-boot tag MUST carry the same value the proxy stamped
  // into the Content-Security-Policy response header.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      className={`${interTight.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body
        className="min-h-full bg-background text-foreground font-sans"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <LocaleProvider initialLocale={locale}>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  color: "var(--popover-foreground)",
                },
              }}
            />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
