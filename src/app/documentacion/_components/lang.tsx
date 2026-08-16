'use client';

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALES, type Locale } from '@/lib/i18n/config';

/**
 * El selector de idioma de la documentación.
 *
 * La app cambia el idioma desde Ajustes, pero acá no hay sesión ni Ajustes: esta
 * página se lee sin cuenta, así que necesita su propio interruptor o alguien que
 * llega en inglés no tiene forma de salir del español.
 *
 * Escribe la misma cookie que usa el resto (`riverz_locale`) y recarga. La
 * cookie queda en el subdominio de la documentación y no en el del producto: no
 * corresponde que leer una página pública cambie el idioma de la cuenta de
 * alguien que quizá ni la tiene.
 */
function escribirCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function LangSwitch({ actual }: { actual: Locale }) {
  const cambiar = (l: Locale) => {
    escribirCookie(l);
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-[#2a2a30] p-0.5">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => cambiar(l)}
          aria-current={l === actual}
          className={[
            'rounded-full px-2.5 py-1 text-[12px] uppercase transition-colors',
            l === actual
              ? 'bg-[#f7ff9e] font-semibold text-[#0a0a0a]'
              : 'text-[#8a8a90] hover:text-[#d8d8dd]',
          ].join(' ')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
