"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { IdleGuard } from "@/components/auth/idle-guard";
import { CsrfProvider } from "@/components/auth/csrf-provider";
import { useT } from "@/hooks/use-locale";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

const COLLAPSE_KEY = "ui.sidebar.collapsed";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
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
    if (!loading && !user) {
      router.push("/ingresar");
    }
  }, [user, loading, router]);

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
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={openSidebar} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <IdleGuard />
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CsrfProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </CsrfProvider>
    </AuthProvider>
  );
}
