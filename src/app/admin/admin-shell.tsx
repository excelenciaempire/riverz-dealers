"use client";

import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronLeft, Lock } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { CsrfProvider } from "@/components/auth/csrf-provider";
import { LocaleToggleButton, ThemeToggleButton } from "@/components/settings/toggles";
import { useT } from "@/hooks/use-locale";
import { limpiarCacheAdmin } from "./_components/admin-ui";

/**
 * Shell del panel de plataforma.
 *
 * Barra superior mínima: la marca (que vuelve al índice), quién está mirando y
 * la salida a la app del comercio. Sin sidebar — el admin no es un tenant — y
 * sin lista de secciones arriba: once nombres no entran, así que la barra
 * terminaba con scroll horizontal, que es peor que no tener menú. El índice
 * agrupado del home es la navegación.
 */
export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const t = useT();

  return (
    <CsrfProvider>
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
            <Link
              href="/admin"
              className="flex shrink-0 items-baseline gap-1.5"
              aria-label={`riverz ${t("admin.title")}`}
            >
              <span className="text-[20px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
                riverz
              </span>
              <span className="text-xs lowercase text-muted-foreground">admin</span>
            </Link>

            <VolverAlIndice />

            <div className="flex-1" />

            <span className="hidden text-xs text-muted-foreground sm:block">{email}</span>
            {/* El panel vive en admin.riverz.co, que es OTRO origen: ni la
                cookie del idioma (host-only) ni el localStorage del tema viajan
                desde la app. Sin estos dos botones, acá no había forma de
                cambiar ninguno de los dos. */}
            <LocaleToggleButton />
            <ThemeToggleButton />
            <LockButton />
            {/* URL absoluta y <a> pelado: el panel vive en admin.riverz.co, asi
                que un href relativo se queda en el subdominio y no lleva a la
                app. Con el host propio, volver a la app es salir del origen. */}
            <a
              href={`${process.env.NEXT_PUBLIC_SITE_URL || "https://riverz.co"}/panel`}
              className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{t("admin.backToApp")}</span>
            </a>
          </div>
        </header>

        {/* El límite de Suspense es del shell y no de cada sección: las
            pantallas con pestañas leen `useSearchParams`, y sin un límite
            arriba Next obliga a poner uno en cada una. Una vez acá lo cubre
            para todo el panel. */}
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
    </CsrfProvider>
  );
}


/**
 * Volver al índice del panel.
 *
 * El panel no tiene menú lateral —once secciones no entran en una barra— así
 * que desde adentro de una sección la única salida era el logo, que nadie lee
 * como "volver". Sin esto, la forma de moverse entre secciones era el botón
 * del navegador.
 *
 * En el índice no aparece: un botón de volver que lleva a donde ya estás es
 * ruido.
 */
function VolverAlIndice() {
  const t = useT();
  const pathname = usePathname();
  // En admin.riverz.co el índice es "/"; en el dominio viejo, "/admin".
  const enElIndice = pathname === "/" || pathname === "/admin";
  if (enElIndice) return null;

  return (
    <Link
      href="/admin"
      className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      <span className="hidden sm:inline">{t("admin.backToIndex")}</span>
    </Link>
  );
}

/**
 * Cerrar el panel sin cerrar la sesión de Riverz.
 *
 * `DELETE /api/admin/unlock` existía desde que se puso la segunda llave y no lo
 * llamaba nada: la única forma de volver a pedir la contraseña era esperar 12
 * horas a que venciera la cookie. En una pantalla que ve todas las cuentas,
 * poder cerrarla al levantarse de la máquina no es un lujo.
 */
function LockButton() {
  const t = useT();
  const [busy, setBusy] = useState(false);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/admin/unlock", {
            method: "DELETE",
            credentials: "same-origin",
          });
          // Cerrar el panel vuelve a pedir la contraseña: lo que se había
          // guardado para pintar rápido no puede sobrevivir a eso.
          limpiarCacheAdmin();
          window.location.reload();
        } catch {
          setBusy(false);
        }
      }}
      disabled={busy}
      title={t("admin.lockPanel")}
      aria-label={t("admin.lockPanel")}
      className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <Lock className="h-4 w-4" />
    </button>
  );
}
