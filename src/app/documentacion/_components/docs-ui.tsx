/**
 * Las piezas visuales de la documentación.
 *
 * La paleta va escrita a mano y no con los tokens del producto. La
 * documentación es oscura siempre, incluso para alguien que tiene la app en
 * claro: se lee sin cuenta y sin sesión, así que no hay preferencia de tema que
 * consultar, y heredar los tokens dejaría la página a merced de un cambio
 * pensado para la bandeja.
 *
 * La regla que imponen estas piezas: un bloque de código scrollea adentro suyo
 * y nunca ensancha la página. Un comando con un token largo es exactamente lo
 * que rompe la lectura en un teléfono.
 */

export const LIMA = '#f7ff9e';

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a8a90]">
      {children}
    </p>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mt-3 text-[34px] font-medium leading-[1.1] tracking-[-1.2px] text-[#fafaf7] sm:text-[46px]">
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 max-w-[42rem] text-[17px] leading-[1.65] text-[#a9a9b0]">{children}</p>
  );
}

/** Una sección de primer nivel. El id es lo que ancla la navegación lateral. */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 pt-16">
      <h2 className="text-[26px] font-medium tracking-[-0.5px] text-[#fafaf7]">{title}</h2>
      {children}
    </section>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-8 text-[15px] font-semibold text-[#fafaf7]">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[14px] leading-[1.7] text-[#a9a9b0]">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 space-y-2 text-[14px] leading-[1.7] text-[#a9a9b0]">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[#55555c]" />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[#1a1a22] px-1.5 py-0.5 font-mono text-[0.86em] text-[#e2e2e6]">
      {children}
    </code>
  );
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-[#1a1a22] p-3.5 font-mono text-[12px] leading-[1.7] text-[#f7ff9e]">
      {children}
    </pre>
  );
}

/** Una tarjeta con título. Cada forma de conectarse vive en una. */
export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-[#222226] bg-[#111114] p-5">
      <p className="text-[15px] font-semibold text-[#fafaf7]">{title}</p>
      {children}
    </div>
  );
}

/** Lo que hay que leer aunque se esté salteando el texto. */
export function Nota({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-xl border border-[#f7ff9e]/25 bg-[#f7ff9e]/[0.06] px-5 py-4 text-[14px] leading-[1.7] text-[#d8d8dd]">
      {children}
    </div>
  );
}

/**
 * Un paso numerado. El número va fuera del texto, en un círculo: le dice a
 * alguien que llega a mitad de página cuántas cosas le faltan.
 */
export function Paso({
  n,
  eyebrow,
  title,
  children,
}: {
  n: number;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-10 flex gap-4">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[#f7ff9e]/40 text-[13px] font-semibold text-[#f7ff9e]">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a8a90]">
          {eyebrow}
        </p>
        <p className="mt-1 text-[18px] font-medium text-[#fafaf7]">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** Una herramienta: el nombre a la izquierda, qué hace a la derecha. */
export function ToolRow({
  name,
  description,
  params,
}: {
  name: string;
  description: string;
  params?: string;
}) {
  return (
    <div className="grid gap-1.5 border-b border-[#1c1c20] px-4 py-3.5 last:border-b-0 sm:grid-cols-[15rem_1fr] sm:gap-5">
      <code className="font-mono text-[13px] text-[#f7ff9e]">{name}</code>
      <div className="min-w-0">
        <p className="text-[13.5px] leading-[1.6] text-[#a9a9b0]">{description}</p>
        {params && <p className="mt-1 text-[12px] text-[#6f6f77]">{params}</p>}
      </div>
    </div>
  );
}

export function ToolTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#222226] bg-[#111114]">
      {children}
    </div>
  );
}

/**
 * El marcado mínimo de los párrafos traducibles.
 *
 * Sin esto, una oración con un nombre de campo o un enlace en el medio hay que
 * partirla en tres cadenas, y entonces quien traduce recibe pedazos sueltos que
 * no puede reordenar: en inglés el enlace cae en otro lugar de la frase. Con el
 * marcado adentro, la unidad traducible es la oración entera.
 *
 * Sólo tres formas, y a propósito: acentos graves para código, dos asteriscos
 * para negrita, corchetes y paréntesis para enlaces. No es Markdown ni pretende
 * serlo; es lo justo para no partir oraciones.
 */
export function Rich({ children }: { children: string }) {
  const partes = children.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {partes.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`')) return <Code key={i}>{p.slice(1, -1)}</Code>;
        if (p.startsWith('**') && p.endsWith('**'))
          return (
            <strong key={i} className="font-semibold text-[#d8d8dd]">
              {p.slice(2, -2)}
            </strong>
          );
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        if (link)
          return (
            <A key={i} href={link[2]}>
              {link[1]}
            </A>
          );
        return p;
      })}
    </>
  );
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-[#f7ff9e] underline decoration-[#f7ff9e]/30 underline-offset-4 transition-colors hover:decoration-[#f7ff9e]"
    >
      {children}
    </a>
  );
}
