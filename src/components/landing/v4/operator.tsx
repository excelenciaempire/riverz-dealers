'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useReducedMotion } from '@/components/landing/landing';

/**
 * Operator — la secuencia que se desarrolla con el scroll.
 *
 * Antes corría sola con un temporizador. El problema de eso no es técnico: es
 * que una animación en bucle se lee como un adorno. Se mira dos segundos, se
 * entiende que es decorativa y se sigue de largo. Atada al scroll, en cambio,
 * la persona la ESTÁ HACIENDO: escribe el pedido al bajar, ve aparecer el
 * reparto y llega al botón de aprobar. El mecanismo se aprende con la mano.
 *
 * Lo que el scroll controla, en orden:
 *
 *   0.00 → 0.30   el pedido se escribe letra por letra
 *   0.30 → 0.38   el campo sube a su lugar y aparece el plan
 *   0.38 → 0.86   los tres encargos entran de a uno, desenfocados a nítidos
 *   0.86 → 1.00   la pregunta, el botón encendido, y el estado aprobado
 *
 * Debajo de 1024 px NO se clava nada: la escena entera no entra en una
 * pantalla de teléfono y clavarla dejaría el contenido recortado. Ahí se
 * muestra la secuencia terminada, que es el fotograma que más información da.
 * Lo mismo con `prefers-reduced-motion`.
 */

const PASOS = [
  { who: 'operation.subContactos', line: 'landingV4.opLine1' },
  { who: 'operation.subPlantillas', line: 'landingV4.opLine2' },
  { who: 'operation.subAutomatizaciones', line: 'landingV4.opLine3' },
] as const;

// Los cortes del recorrido, juntos para poder leer el ritmo de un vistazo.
const ESCRIBE_HASTA = 0.3;
const SUBE_HASTA = 0.38;
const REPARTO_HASTA = 0.86;

const recorte = (v: number) => Math.min(1, Math.max(0, v));

export function Operator() {
  const t = useT();
  const reduced = useReducedMotion();
  const outer = useRef<HTMLElement>(null);
  const [p, setP] = useState(0);
  const [fijo, setFijo] = useState(false);

  useEffect(() => {
    const el = outer.current;
    if (!el) return;

    // La secuencia solo se ata al scroll donde la sección se clava. Si no,
    // avanzar movería cosas que ya están todas a la vista y se vería roto.
    const mq = window.matchMedia('(min-width: 1024px)');
    let raf = 0;

    const leer = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      if (span <= 0) return;
      setP(recorte(-r.top / span));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(leer);
    };
    const onMedia = () => setFijo(mq.matches && !reduced);

    onMedia();
    leer();
    mq.addEventListener?.('change', onMedia);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      mq.removeEventListener?.('change', onMedia);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reduced]);

  // Sin clavado, la secuencia se muestra terminada.
  const q = fijo ? p : 1;

  const prompt = t('landingV4.opPrompt');
  const escritas = Math.round(prompt.length * recorte(q / ESCRIBE_HASTA));
  const escribiendo = q < SUBE_HASTA;
  const planVisible = q >= SUBE_HASTA;

  // Cada encargo tiene su tramo del recorrido, y dentro del tramo su propia
  // curva: así entran de a uno y no los tres de golpe.
  const tramo = (REPARTO_HASTA - SUBE_HASTA) / PASOS.length;
  const avanceDe = (i: number) =>
    recorte((q - (SUBE_HASTA + tramo * i)) / (tramo * 0.7));

  const preguntando = q >= REPARTO_HASTA;
  const aprobado = q >= 0.95;

  return (
    <section
      ref={outer}
      id="operator"
      className="sn-full sn-op relative scroll-mt-24"
      style={{ background: 'var(--sn-ink)' }}
    >
      <div className="sn-op-in flex flex-col justify-center overflow-hidden">
        {/* El resplandor crece con el avance: al principio la pantalla está
            casi apagada y al final el reparto está iluminado. Es lo único que
            cambia en el fondo, y alcanza para que la sección se sienta viva. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(58% 46% at 50% 42%, rgba(247,255,158,0.14), rgba(247,255,158,0) 70%)',
            opacity: 0.25 + q * 0.75,
          }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-5 py-20 lg:py-0">
          <div className="grid items-center gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
            <div>
              <h2
                className="sn-h2 max-w-[14ch]"
                style={{ color: 'var(--sn-card)' }}
              >
                {t('landingV4.operatorTitle')}
              </h2>
              <p
                className="mt-5 max-w-[42ch] text-[16px] leading-relaxed"
                style={{ color: 'rgba(250,247,241,0.82)' }}
              >
                {t('landingV4.operatorLead')}
              </p>

              {/* El riel: dice cuánto falta sin escribir «paso 2 de 4». */}
              <div
                aria-hidden
                className="mt-10 hidden h-[3px] w-40 overflow-hidden rounded-full lg:block"
                style={{ background: 'rgba(250,247,241,0.12)' }}
              >
                <i
                  className="block h-full rounded-full"
                  style={{
                    width: `${q * 100}%`,
                    background: 'var(--sn-accent)',
                  }}
                />
              </div>
            </div>

            <div className="relative min-w-0 lg:min-h-[420px]">
              {/* El campo: centrado mientras se escribe, como el de ChatGPT
                  cuando todavía no hay conversación; después se encoge a su
                  contenido y sube a la derecha. */}
              <div
                className="lg:absolute lg:inset-x-0"
                style={
                  fijo
                    ? {
                        top: escribiendo ? '38%' : '0%',
                        transform: escribiendo
                          ? 'translateY(-50%)'
                          : 'translateY(0)',
                        transition:
                          'top 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1)',
                      }
                    : undefined
                }
              >
                <div
                  className="flex items-center gap-3 rounded-[20px] px-4 py-3.5"
                  style={{
                    background: escribiendo
                      ? 'rgba(250,247,241,0.06)'
                      : 'rgba(250,247,241,0.1)',
                    boxShadow: escribiendo
                      ? '0 0 0 1px rgba(250,247,241,0.1)'
                      : 'none',
                    width: escribiendo ? '100%' : 'fit-content',
                    marginLeft: 'auto',
                    maxWidth: '100%',
                    transition:
                      'width 0.6s cubic-bezier(0.16,1,0.3,1), background-color 0.4s ease, box-shadow 0.4s ease',
                  }}
                >
                  <span
                    className="min-w-0 flex-1 text-[15px] leading-snug"
                    style={{ color: 'rgba(250,247,241,0.92)' }}
                  >
                    {fijo ? prompt.slice(0, escritas) : prompt}
                    {fijo && escritas < prompt.length && (
                      <span aria-hidden style={{ opacity: 0.55 }}>
                        |
                      </span>
                    )}
                  </span>
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: 'var(--sn-accent)',
                      opacity: escribiendo ? 1 : 0.5,
                      transition: 'opacity 0.4s ease',
                    }}
                  >
                    <ArrowUp
                      className="size-4"
                      style={{ color: 'var(--sn-ink)' }}
                    />
                  </span>
                </div>
              </div>

              <div
                className="mt-8 lg:absolute lg:inset-x-0 lg:top-[92px] lg:mt-0"
                style={fijo ? { opacity: planVisible ? 1 : 0 } : undefined}
              >
                <ul className="space-y-3">
                  {PASOS.map((s, i) => {
                    const a = fijo ? avanceDe(i) : 1;
                    return (
                      <li
                        key={s.line}
                        className="flex items-start gap-3 rounded-xl px-3.5 py-3"
                        style={{
                          background: `rgba(250,247,241,${0.02 + a * 0.05})`,
                          opacity: a,
                          // Entra desde abajo y desenfocado. La nitidez
                          // llegando es lo que lo hace sentir caro; un fundido
                          // de opacidad solo, no.
                          transform: `translateY(${(1 - a) * 14}px)`,
                          filter: `blur(${(1 - a) * 5}px)`,
                        }}
                      >
                        <span
                          className="mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full"
                          style={{
                            background: 'var(--sn-accent)',
                            transform: `scale(${0.6 + a * 0.4})`,
                          }}
                        >
                          <Check
                            className="size-2.5"
                            style={{ color: 'var(--sn-ink)' }}
                          />
                        </span>
                        <span className="min-w-0">
                          <span
                            className="sn-label"
                            style={{ color: 'rgba(250,247,241,0.72)' }}
                          >
                            {t(s.who)}
                          </span>
                          <span
                            className="mt-1 block text-[15px] leading-snug"
                            style={{ color: 'rgba(250,247,241,0.9)' }}
                          >
                            {t(s.line)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div
                  className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3"
                  style={
                    fijo
                      ? {
                          opacity: preguntando ? 1 : 0,
                          transform: `translateY(${preguntando ? 0 : 10}px)`,
                          transition:
                            'opacity 0.4s ease, transform 0.5s cubic-bezier(0.16,1,0.3,1)',
                        }
                      : undefined
                  }
                >
                  <span
                    className="text-[15px]"
                    style={{ color: 'rgba(250,247,241,0.9)' }}
                  >
                    {t('landingV4.opAsk')}
                  </span>
                  <span
                    className="rounded-full px-4 py-2 text-[13px] font-medium"
                    style={{
                      background: aprobado
                        ? 'rgba(250,247,241,0.12)'
                        : 'var(--sn-accent)',
                      color: aprobado
                        ? 'rgba(250,247,241,0.82)'
                        : 'var(--sn-ink)',
                      boxShadow: aprobado
                        ? 'none'
                        : '0 0 34px 2px rgba(247,255,158,0.34)',
                      transition:
                        'background-color 0.4s ease, color 0.4s ease, box-shadow 0.4s ease',
                    }}
                  >
                    {t('landingV4.opApprove')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
