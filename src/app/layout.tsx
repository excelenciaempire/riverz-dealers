import type { Metadata, Viewport } from "next";
import { Inter_Tight } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { DEFAULT_THEME, STORAGE_KEY, THEME_IDS } from "@/lib/themes";

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
    default: "Riverz — CRM con IA para WhatsApp e Instagram",
    template: "%s · Riverz",
  },
  description:
    "Riverz es el CRM con agentes de IA que atiende, vende y responde por ti en WhatsApp, Instagram y más. Bandeja unificada, automatizaciones y campañas en un solo lugar.",
  applicationName: "Riverz",
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
  openGraph: {
    type: "website",
    siteName: "Riverz",
    title: "Riverz — CRM con IA para WhatsApp e Instagram",
    description:
      "El CRM con agentes de IA que atiende, vende y responde por ti en WhatsApp, Instagram y más.",
    url: "/",
    locale: "es_ES",
  },
  twitter: {
    card: "summary_large_image",
    title: "Riverz — CRM con IA para WhatsApp e Instagram",
    description:
      "El CRM con agentes de IA que atiende, vende y responde por ti en WhatsApp, Instagram y más.",
  },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/icon" }],
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

// Inline boot script — runs before React hydrates so the user's
// chosen theme is on the <html> element before first paint. Without
// this every page load flashes the default Violet for a frame before
// the React tree mounts and applies the picked theme.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid theme IDs
// is sourced from the THEME_IDS constant so adding a theme doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var STORAGE_KEY = ${JSON.stringify(STORAGE_KEY)};
    var DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var ALLOWED = ${JSON.stringify(THEME_IDS)};
    var saved = localStorage.getItem(STORAGE_KEY);
    var theme = ALLOWED.indexOf(saved) !== -1 ? saved : DEFAULT;
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

  return (
    <html
      lang="en"
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
        </ThemeProvider>
      </body>
    </html>
  );
}
