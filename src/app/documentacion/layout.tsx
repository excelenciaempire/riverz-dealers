import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Documentación · Riverz',
  description:
    'Cómo conectar tu propio agente a Riverz por MCP: llaves, OAuth y todas las herramientas.',
};

/**
 * La documentación.
 *
 * Vive en docs.riverz.co y se lee sin cuenta: es lo único de Riverz que alguien
 * puede necesitar ANTES de tener una. Por eso no comparte el shell de la app —
 * ni sidebar, ni sesión, ni nada que sugiera que hay que entrar primero.
 *
 * Se escribe en el mismo tono que el resto: se explica por qué, no sólo qué. Un
 * apartado de documentación que sólo lista endpoints obliga a adivinar cuál usar.
 */
const SECCIONES = [
  { href: '/documentacion', label: 'Introducción' },
  { href: '/documentacion/mcp', label: 'Conectar un agente' },
  { href: '/documentacion/mcp/oauth', label: 'OAuth' },
  { href: '/documentacion/mcp/herramientas', label: 'Herramientas' },
  { href: '/documentacion/mcp/seguridad', label: 'Seguridad' },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/documentacion" className="flex shrink-0 items-baseline gap-1.5">
            <span className="text-[20px] font-semibold lowercase leading-none tracking-[0.04em] text-primary">
              riverz
            </span>
            <span className="text-xs lowercase text-muted-foreground">docs</span>
          </Link>
          <div className="flex-1" />
          <a
            href={process.env.NEXT_PUBLIC_SITE_URL || 'https://riverz.co'}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Ir a la app
          </a>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-8 px-4 py-8 sm:px-6">
        <nav className="hidden w-52 shrink-0 md:block">
          <ul className="sticky top-20 space-y-0.5">
            {SECCIONES.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
