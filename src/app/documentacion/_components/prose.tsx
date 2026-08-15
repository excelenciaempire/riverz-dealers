/**
 * Las piezas de una página de documentación.
 *
 * Existen para que las páginas sean su contenido y nada más. La regla que
 * imponen: un bloque de código siempre scrollea adentro suyo, nunca ensancha la
 * página — un ejemplo de curl con un token largo es exactamente lo que rompe la
 * lectura en un teléfono.
 */
export function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight text-foreground">{children}</h1>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 border-b border-border pb-2 text-lg font-semibold text-foreground">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold text-foreground">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-base leading-relaxed text-muted-foreground">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

/** Lo que hay que leer aunque se esté salteando el texto. */
export function Nota({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm leading-relaxed text-amber-800 dark:text-amber-200">
      {children}
    </div>
  );
}
