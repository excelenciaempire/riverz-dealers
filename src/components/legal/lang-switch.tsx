"use client";

import { LOCALES } from "@/lib/i18n/config";
import { useLocale } from "@/hooks/use-locale";

/**
 * Conmutador de idioma para las páginas legales públicas (términos,
 * privacidad, eliminar datos, soporte).
 *
 * Estas páginas se leen sin cuenta y sin la barra de la app, así que no hay
 * ningún otro lugar donde cambiar el idioma: quien llega en español a los
 * términos en inglés (o al revés) se queda sin salida. Usa el mismo
 * `setLocale` del resto, que guarda la cookie y cambia el slug de la URL
 * (/terminos ↔ /terms).
 */
export function LegalLangSwitch() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => setLocale(loc)}
          aria-pressed={locale === loc}
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
            locale === loc
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {loc}
        </button>
      ))}
    </div>
  );
}
