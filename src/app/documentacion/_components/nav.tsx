'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * La navegación lateral y el botón que copia la página entera.
 *
 * Toda la documentación vive en una sola página, así que la navegación son
 * anclas y no rutas: nada se recarga y el buscador del navegador encuentra todo
 * de una. La sección activa se resuelve mirando qué encabezado está arriba de
 * la mitad de la pantalla, que es lo que alguien leyendo diría que está
 * leyendo; un IntersectionObserver a secas marca la que asoma abajo.
 *
 * El botón de copiar está primero a propósito. Quien conecta un agente no lee
 * esta página: se la pasa al asistente y le pide que se conecte. Ese texto se
 * arma en el servidor desde el registro de herramientas, así que no puede
 * quedar viejo.
 */

export interface NavItem {
  id: string;
  label: string;
  sub?: boolean;
}

export function DocsNav({ items, textoCompleto }: { items: NavItem[]; textoCompleto: string }) {
  const [activo, setActivo] = useState(items[0]?.id ?? '');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const marcar = () => {
      const corte = window.innerHeight * 0.4;
      let visto = items[0]?.id ?? '';
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= corte) visto = it.id;
      }
      setActivo(visto);
    };
    marcar();
    window.addEventListener('scroll', marcar, { passive: true });
    return () => window.removeEventListener('scroll', marcar);
  }, [items]);

  return (
    <div className="sticky top-6">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(textoCompleto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[#f7ff9e] px-4 py-2 text-[13px] font-semibold text-[#0a0a0a] transition-opacity hover:opacity-90"
      >
        {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copiado ? 'Copiado' : 'Copiar todo'}
      </button>

      <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6f6f77]">
        Conector MCP
      </p>

      <ul className="mt-3 space-y-px">
        {items.map((it) => {
          const on = activo === it.id;
          return (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                className={[
                  'block border-l py-1.5 text-[13.5px] transition-colors',
                  it.sub ? 'pl-6' : 'pl-3.5',
                  on
                    ? 'border-[#f7ff9e] text-[#fafaf7]'
                    : 'border-transparent text-[#8a8a90] hover:text-[#d8d8dd]',
                ].join(' ')}
              >
                {it.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
