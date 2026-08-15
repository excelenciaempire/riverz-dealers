"use client";

import { useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { CsrfProvider } from "@/components/auth/csrf-provider";
import { useT } from "@/hooks/use-locale";

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
              <span className="text-[20px] font-semibold lowercase leading-none tracking-[0.04em] text-primary">
                riverz
              </span>
              <span className="text-xs lowercase text-muted-foreground">admin</span>
            </Link>

            <div className="flex-1" />

            <span className="hidden text-xs text-muted-foreground sm:block">{email}</span>
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

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </CsrfProvider>
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
