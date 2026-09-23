'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useReducedMotion } from '@/components/landing/landing';

const STEPS = [
  'landingV4.opLine1',
  'landingV4.opLine2',
  'landingV4.opLine3',
] as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** A short, one-time demonstration inside the preceding editorial section. */
export function Operator() {
  const t = useT();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0.5);

  useEffect(() => {
    if (reduced || !root.current) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const started = performance.now();
        const tick = (now: number) => {
          const next = clamp((now - started) / 6000);
          setProgress(0.5 + next * 0.5);
          if (next < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.25 }
    );
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const p = reduced ? 1 : progress;

  return (
    <div ref={root} id="operator" className="sn-operator-demo scroll-mt-24">
        <div className="sn-operator-screen" aria-label={t('landingV4.operatorTitle')}>
          <div className="sn-operator-prompt">
            <span>{t('landingV4.opPrompt')}</span>
            <span className="sn-operator-send" aria-hidden="true">
              <ArrowUp size={16} />
            </span>
          </div>
          <ul className="sn-operator-steps">
            {STEPS.map((step, index) => {
              const reveal = clamp((p - (0.47 + index * 0.13)) / 0.16);
              return (
                <li
                  key={step}
                  style={{
                    opacity: 0.72 + reveal * 0.28,
                    transform: `translateY(${(1 - reveal) * 4}px)`,
                  }}
                >
                  <span className="sn-operator-check" aria-hidden="true">
                    <Check size={12} />
                  </span>
                  <span className="sn-operator-step-action">{t(step)}</span>
                </li>
              );
            })}
          </ul>
          <div
            className="sn-operator-approval"
            style={{ opacity: 0.72 + clamp((p - 0.84) / 0.12) * 0.28 }}
          >
            <span>{t('landingV4.opAsk')}</span>
            <span className="sn-operator-approve">
              {t('landingV4.opApprove')}
            </span>
          </div>
        </div>
    </div>
  );
}
