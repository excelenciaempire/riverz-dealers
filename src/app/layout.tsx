import type { Metadata, Viewport } from "next";
import {
  Inter_Tight,
  Fraunces,
  Martian_Mono,
  Instrument_Serif,
  Instrument_Sans,
  Geist_Mono,
} from "next/font/google";
import { headers } from "next/headers";
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

// Tipografía exclusiva de la portada «Papel y Señal» (/portada). Fraunces es
// una serif variable con ejes SOFT y WONK: subiendo WONK la `g`, la `y` y la
// `f` se tuercen, y el titular queda con una forma que no tiene nadie más en
// la categoría. Martian Mono, ancha, carga solo etiquetas y números.
//
// next/font descarga y sirve ambas desde el propio dominio en build, así que
// pasan el `font-src 'self' data:` de la CSP sin abrirla (src/proxy.ts).
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

const martianMono = Martian_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// Tipografía de la portada editorial (/portada-b). Instrument Serif e
// Instrument Sans son de la misma fundición y están dibujadas para ir juntas:
// una serif de contraste alto con ascendentes largas para los titulares
// grandes, y una grotesca neutra para navegación y texto corrido. Geist Mono
// carga solo etiquetas en mayúsculas y cifras.
const instrumentSerif = Instrument_Serif({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono-label",
  subsets: ["latin"],
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
    { media: "(prefers-color-scheme: light)", color: "#f5f3ec" },
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
      className={`${interTight.variable} ${fraunces.variable} ${martianMono.variable} ${instrumentSerif.variable} ${instrumentSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* A mano y no por `metadata.other`, que lo emite como `name="fb:app_id"`:
            Open Graph solo lee `property`, así que Meta lo descartaba. */}
        <meta property="fb:app_id" content="1021515967221344" />
        {/* Un <script> pelado, que es lo que Next documenta para el arranque
            del tema, y no `next/script` con `beforeInteractive`: para un inline
            en el <head> hacen exactamente lo mismo.

            `suppressHydrationWarning` no tapa un descuido. El navegador BORRA el
            valor del `nonce` del DOM en cuanto lo aplica —para que una
            inyección no pueda leerlo y reusarlo—, así que al hidratar el cliente
            ve "" donde el servidor escribió el valor y React lo reporta como
            desajuste en cada carga. No hay nada que corregir: es la protección
            funcionando. Sin esto, el contador de errores del modo desarrollo
            marca uno permanente y tapa lo que sí importa. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
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
