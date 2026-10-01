"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { NavProgress } from "@/components/layout/nav-progress";
import { StoreClaimGuard } from "@/components/settings/store-claim-guard";
import { SectionGuard } from "@/components/layout/section-guard";
import { CsrfProvider } from "@/components/auth/csrf-provider";
import { FeatureFlagsProvider } from "@/hooks/use-feature-flags";
import { SinSaldoDialog } from "@/components/billing/sin-saldo-dialog";
import type { FeatureFlags } from "@/lib/admin/feature-flags";
import { useT } from "@/hooks/use-locale";
import { SaldoProvider } from "@/hooks/use-saldo";
import type { Vistazo } from "@/lib/wallet/puerta";
import { COMMERCE_CHANGE_KEY, selectedCommerceInBrowser } from "@/lib/auth/commerce-cookies";
import { AppInstallationCapture } from '@/components/settings/app-installation';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

const COLLAPSE_KEY = "ui.sidebar.collapsed";

function DashboardShellInner({
  children,
  aviso,
}: {
  children: React.ReactNode;
  aviso?: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useLocalizedRouter();
  const t = useT();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible (in collapsed or full-width form) and this stays at
  // `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Desktop-only: collapse the sidebar to a slim icon-only rail to give
  // the main content more room. Persisted to localStorage so each user's
  // last choice survives reloads.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // localStorage may be disabled (Safari private mode, embedded
      // contexts) — silently fall back to expanded.
    }
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // No-op — see read above.
      }
      return next;
    });
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);

  useEffect(() => {
    const initialCommerce = selectedCommerceInBrowser();
    const sync = () => {
      if (initialCommerce !== selectedCommerceInBrowser()) window.location.reload();
    };
    const onStorage = (event: StorageEvent) => { if (event.key === COMMERCE_CHANGE_KEY) sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/ingresar");
    }
  }, [user, loading, router]);

  // bfcache guard: the browser can restore a frozen, fully-rendered
  // snapshot of an authed page from its back/forward cache (pageshow with
  // `persisted`). After switching accounts in the same tab, that snapshot
  // would show the PREVIOUS session's data (e.g. another workspace's
  // Shopify connection) until a manual reload. Force a fresh load on a
  // bfcache restore so the page always reflects the current session. This
  // only fires for cross-document bfcache restores, never on the SPA's
  // own client-side navigations, so it's effectively free in normal use.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("layout.loading")}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    // h-dvh (dynamic viewport height) rather than h-screen/100vh: on mobile
    // the URL bar grows/shrinks the visible area and 100vh ignores that,
    // clipping the app's bottom under the browser chrome. dvh tracks the
    // real visible height; identical to 100vh on desktop.
    <div className="flex h-screen overflow-hidden bg-background supports-[height:100dvh]:h-dvh">
      <NavProgress />
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={openSidebar} />
        {/* El aviso de cobro va debajo del encabezado y arriba del contenido:
            se ve siempre, en cualquier pantalla, y no tapa nada. */}
        {aviso}
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <SinSaldoDialog />
      <StoreClaimGuard />
      <SectionGuard />
    </div>
  );
}

export function DashboardShell({
  children,
  flags = {},
  isPlatformAdmin = false,
  aviso,
  saldo = null,
}: {
  children: React.ReactNode;
  flags?: FeatureFlags;
  isPlatformAdmin?: boolean;
  aviso?: React.ReactNode;
  /** El saldo que ya leyó el layout, para pintarlo en el primer render. */
  saldo?: Vistazo | null;
}) {
  return (
    <AuthProvider>
      <CsrfProvider>
        <FeatureFlagsProvider value={{ flags, isPlatformAdmin }}>
          <SaldoProvider inicial={saldo}>
            <AppInstallationCapture />
            <DashboardShellInner aviso={aviso}>{children}</DashboardShellInner>
          </SaldoProvider>
        </FeatureFlagsProvider>
      </CsrfProvider>
    </AuthProvider>
  );
}
