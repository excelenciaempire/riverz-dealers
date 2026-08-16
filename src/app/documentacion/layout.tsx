import type { Metadata } from 'next';
import Link from 'next/link';

import { getLocale } from '@/lib/i18n/server';
import { d } from './_content/copy';
import { LangSwitch } from './_components/lang';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: d(locale, 'metaTitle'), description: d(locale, 'metaDesc') };
}

/**
 * La documentación.
 *
 * Vive en docs.riverz.co y se lee sin cuenta: es lo único de Riverz que alguien
 * puede necesitar ANTES de tener una. Por eso no comparte el shell de la app —
 * ni barra lateral, ni sesión, ni nada que sugiera que hay que entrar primero.
 *
 * El fondo se pinta acá y no en el body: la app respeta el tema del sistema y
 * esta página es oscura siempre, así que el color va explícito.
 */
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-[#fafaf7] antialiased" lang={locale}>
      <header className="border-b border-[#1a1a1e]">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-5 sm:px-8">
          {/* En el host de la documentacion la raiz ES esta pagina (la reescribe
              el proxy), asi que el wordmark vuelve arriba sin salir del sitio. */}
          <Link href="/" className="text-[19px] font-bold lowercase text-[#fafaf7]">
            riverz
          </Link>
          <div className="flex-1" />
          <LangSwitch actual={locale} />
          <a
            href={`${process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co'}/ajustes?tab=mcp`}
            className="rounded-full border border-[#2a2a30] px-4 py-2 text-[13px] text-[#d8d8dd] transition-colors hover:border-[#f7ff9e]/50 hover:text-[#fafaf7]"
          >
            {d(locale, 'goToSettings')}
          </a>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1180px] gap-12 px-5 pb-28 sm:px-8">{children}</div>
    </div>
  );
}
