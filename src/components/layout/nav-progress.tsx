"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Barra de progreso de navegación (estilo GitHub).
 *
 * La navegación del dashboard ES cliente (SPA) — el shell no se recarga — pero
 * algunas páginas tardan 1-2s en traer sus datos y el área de contenido queda
 * en blanco/spinner, lo que se percibe como "recargar la página". Esta barra da
 * feedback inmediato al hacer clic en un link interno SIN tapar el contenido:
 * el contenido anterior se mantiene mientras carga y la barra indica que algo
 * está pasando. Se completa/oculta cuando la nueva ruta ya montó.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const prevPath = useRef(pathname);

  // Arrancar la barra al hacer clic en un link interno (fase de captura, para
  // adelantarnos al handler de next/link).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || !href.startsWith("/") || (target && target !== "_self")) return;
      if (href.split("?")[0] === window.location.pathname) return;
      setActive(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Apagar cuando la ruta ya cambió (nueva página montada).
  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      const t = setTimeout(() => setActive(false), 200);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5">
      <div
        className={cn(
          "h-full bg-primary ease-out",
          active
            ? "w-[92%] opacity-100 transition-[width] duration-[1800ms]"
            : "w-full opacity-0 transition-opacity duration-200",
        )}
      />
    </div>
  );
}
