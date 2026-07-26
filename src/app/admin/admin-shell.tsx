"use client";

import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { CsrfProvider } from "@/components/auth/csrf-provider";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { ADMIN_SECTIONS } from "./sections";

/**
 * Shell del panel de plataforma: barra superior con las secciones y salida
 * de vuelta a la app del merchant. Sin sidebar — el admin no es un tenant.
 */
export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();

  return (
    <CsrfProvider>
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
            <Link
              href="/admin"
              className="flex shrink-0 items-baseline gap-1.5"
              aria-label={`riverz ${t("admin.title")}`}
            >
              <span className="text-[20px] font-semibold lowercase leading-none tracking-[0.04em] text-primary">
                riverz
              </span>
              <span className="text-xs lowercase text-muted-foreground">admin</span>
            </Link>

            <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
              {ADMIN_SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    pathname.startsWith(s.href)
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(s.label)}
                </Link>
              ))}
            </nav>

            <span className="hidden text-xs text-muted-foreground sm:block">{email}</span>
            <Link
              href="/panel"
              className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{t("admin.backToApp")}</span>
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </CsrfProvider>
  );
}
