import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Riverz Docs · Conector MCP',
  description:
    'Cómo conectar tu propio agente a Riverz por MCP: llaves, OAuth y todas las herramientas.',
};

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
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-[#fafaf7] antialiased">
      <header className="border-b border-[#1a1a1e]">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-4 px-5 sm:px-8">
          <a href="/documentacion" className="text-[19px] font-bold lowercase text-[#fafaf7]">
            riverz
          </a>
          <div className="flex-1" />
          <a
            href={`${process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co'}/ajustes?tab=mcp`}
            className="rounded-full border border-[#2a2a30] px-4 py-2 text-[13px] text-[#d8d8dd] transition-colors hover:border-[#f7ff9e]/50 hover:text-[#fafaf7]"
          >
            Ir a Ajustes
          </a>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1180px] gap-12 px-5 pb-28 sm:px-8">
        {children}
      </div>
    </div>
  );
}
