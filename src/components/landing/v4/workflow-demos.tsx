'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CheckCheck,
  Database,
  Headphones,
  LockKeyhole,
  MessageSquare,
  Package,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
} from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import './workflow-demos.css';

/** Finite, viewport-triggered choreography. The complete demo stays readable
 * without JS or with reduced motion; replay is explicit, never an endless loop. */
function Demo({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    let started = false;
    let visible = false;
    const sync = () => {
      if (reduced.matches) {
        animations.forEach((a) => a.cancel());
        return;
      }
      if (visible && !document.hidden && !started) {
        started = true;
        animations = Array.from(
          root.querySelectorAll<HTMLElement>('[data-beat]')
        ).map((el) => {
          const grow = el.dataset.grow === 'true';
          return el.animate(
            grow
              ? [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }]
              : [
                  { opacity: 0, transform: 'translateY(12px)' },
                  { opacity: 1, transform: 'translateY(0)' },
                ],
            {
              duration: grow ? 850 : 600,
              delay: Number(el.dataset.beat),
              easing: 'cubic-bezier(.22,1,.36,1)',
              fill: 'both',
            }
          );
        });
      }
      animations.forEach((a) => {
        if (a.playState === 'finished' || a.playState === 'idle') return;
        if (visible && !document.hidden) a.play();
        else a.pause();
      });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { threshold: 0.25 }
    );
    observer.observe(root);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      animations.forEach((a) => a.cancel());
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [replay]);
  return (
    <div className="rz-demo" ref={ref}>
      <div className="rz-demo-caption">
        <span>{t('landingV4.demoLabel')}</span>
        <button
          type="button"
          onClick={() => setReplay((n) => n + 1)}
          aria-label={t('landingV4.motionReplay')}
          title={t('landingV4.motionReplay')}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="rz-demo-window">
        <div className="rz-demo-toolbar">
          <span className="rz-demo-brand">
            r<span>·</span>
          </span>
          <span>{t(title)}</span>
          <span className="rz-demo-window-dot" />
        </div>
        <div className="rz-demo-content">{children}</div>
      </div>
    </div>
  );
}

function Status({
  children,
  beat = 3000,
}: {
  children: ReactNode;
  beat?: number;
}) {
  return (
    <div className="rz-demo-status" data-beat={beat}>
      <span className="rz-demo-check">
        <Check size={15} />
      </span>
      {children}
      <ArrowUpRight size={16} />
    </div>
  );
}

export function ConversationDemo() {
  const t = useT();
  return (
    <Demo title="landingV4.motionInbox">
      <div className="rz-demo-person">
        <span className="rz-demo-avatar">LM</span>
        <div>
          <strong>Laura M.</strong>
          <small>WhatsApp</small>
        </div>
        <span className="rz-demo-chip">
          <Sparkles size={12} />
          {t('landingV4.motionAgent')}
        </span>
      </div>
      <div className="rz-demo-chat">
        <div className="rz-demo-bubble" data-beat="150">
          {t('landingV4.motionQuestion')}
        </div>
        <div className="rz-demo-context-tag" data-beat="1000">
          <Database size={12} />
          {t('landingV4.motionChecked')}
        </div>
        <div className="rz-demo-bubble rz-demo-sent" data-beat="1700">
          {t('landingV4.motionAnswer')}
          <CheckCheck size={13} />
        </div>
        <div className="rz-demo-product" data-beat="2300">
          <span className="rz-demo-product-icon">
            <ShoppingBag size={27} strokeWidth={1.3} />
          </span>
          <div>
            <strong>{t('landingV4.motionProduct')}</strong>
            <small>{t('landingV4.motionVariant')}</small>
          </div>
          <ArrowUpRight size={18} />
        </div>
      </div>
      <Status beat={3100}>{t('landingV4.motionCheckout')}</Status>
    </Demo>
  );
}

export function ContextDemo() {
  const t = useT();
  return (
    <Demo title="landingV4.motionContext">
      <div className="rz-demo-query" data-beat="100">
        <MessageSquare size={18} />
        <span>{t('landingV4.motionQuestion')}</span>
      </div>
      <div className="rz-demo-sources">
        {[
          { icon: Package, title: 'motionCatalog', value: 'motionVariant' },
          { icon: Database, title: 'motionStock', value: 'motionAvailable' },
          { icon: Truck, title: 'motionDelivery', value: 'motionShipping' },
        ].map((item, i) => (
          <div
            className="rz-demo-source"
            data-beat={600 + i * 500}
            key={item.title}
          >
            <span className="rz-demo-source-icon">
              <item.icon size={18} strokeWidth={1.5} />
            </span>
            <div>
              <small>{t(`landingV4.${item.title}`)}</small>
              <strong>{t(`landingV4.${item.value}`)}</strong>
            </div>
            <Check size={15} />
          </div>
        ))}
      </div>
      <div className="rz-demo-connector" data-beat="2200">
        <ArrowDown size={19} />
      </div>
      <div className="rz-demo-insight" data-beat="2600">
        <Sparkles size={20} />
        <div>
          <strong>{t('landingV4.motionReady')}</strong>
          <small>{t('landingV4.motionGrounded')}</small>
        </div>
      </div>
    </Demo>
  );
}

export function PermissionsDemo() {
  const t = useT();
  return (
    <Demo title="landingV4.motionPermissions">
      <div className="rz-demo-section-title">
        <ShieldCheck size={21} />
        <div>
          <strong>{t('landingV4.motionRules')}</strong>
          <small>{t('landingV4.motionControl')}</small>
        </div>
      </div>
      <div className="rz-demo-rules">
        {[
          ['motionTracking', 'motionAuto', 'auto'],
          ['motionAddress', 'motionApproval', 'review'],
          ['motionRefund', 'motionHuman', 'human'],
        ].map(([action, mode, tone], i) => (
          <div className="rz-demo-rule" key={action} data-beat={350 + i * 650}>
            <span>{t(`landingV4.${action}`)}</span>
            <span className={`rz-demo-mode rz-demo-mode-${tone}`}>
              {tone === 'auto' ? (
                <Check size={12} />
              ) : tone === 'review' ? (
                <LockKeyhole size={12} />
              ) : (
                <Headphones size={12} />
              )}
              {t(`landingV4.${mode}`)}
            </span>
          </div>
        ))}
      </div>
      <div className="rz-demo-approval" data-beat="2500">
        <span className="rz-demo-source-icon">
          <LockKeyhole size={18} />
        </span>
        <div>
          <strong>{t('landingV4.motionWaiting')}</strong>
          <small>{t('landingV4.motionNoChange')}</small>
        </div>
        <span className="rz-demo-avatar rz-demo-avatar-small">JD</span>
      </div>
    </Demo>
  );
}

export function OrderDemo() {
  const t = useT();
  return (
    <Demo title="landingV4.motionOrders">
      <div className="rz-demo-order-head">
        <div>
          <small>{t('landingV4.motionOrder')}</small>
          <strong>#1042</strong>
        </div>
        <span className="rz-demo-chip">
          <ShoppingBag size={12} />
          Shopify
        </span>
      </div>
      <div className="rz-demo-order-product">
        <span className="rz-demo-product-icon">
          <ShoppingBag size={32} strokeWidth={1.2} />
        </span>
        <div>
          <strong>{t('landingV4.motionProduct')}</strong>
          <small>{t('landingV4.motionVariant')}</small>
        </div>
      </div>
      <div className="rz-demo-timeline">
        {[
          ['motionLink', 'motionSent'],
          ['motionPayment', 'motionVerified'],
          ['motionOrderReady', 'motionSynced'],
        ].map(([title, note], i) => (
          <div className="rz-demo-event" data-beat={400 + i * 900} key={title}>
            <span className="rz-demo-event-dot">
              <Check size={12} />
            </span>
            <strong>{t(`landingV4.${title}`)}</strong>
            <small>{t(`landingV4.${note}`)}</small>
          </div>
        ))}
      </div>
      <Status beat={3300}>{t('landingV4.motionDone')}</Status>
    </Demo>
  );
}

export function ResultsDemo() {
  const t = useT();
  const fmt = useFormat();
  return (
    <Demo title="landingV4.motionResults">
      <div className="rz-demo-summary">
        <div>
          <small>{t('landingV4.motionResolved')}</small>
          <strong>
            {fmt.number(128)}
            <span>
              <ArrowUpRight size={20} />
            </span>
          </strong>
        </div>
        <span className="rz-demo-period">{t('landingV4.motionWeek')}</span>
      </div>
      <div
        className="rz-demo-chart"
        aria-label={t('landingV4.motionChart')}
        role="img"
      >
        {[36, 52, 44, 68, 59, 84, 96].map((height, i) => (
          <div className="rz-demo-bar-track" key={i}>
            <span
              className="rz-demo-bar"
              data-grow="true"
              data-beat={350 + i * 70}
              style={{ height: `${height}%` }}
            />
          </div>
        ))}
      </div>
      <div className="rz-demo-chart-labels">
        <span>{t('landingV4.motionWeekStart')}</span>
        <span>{t('landingV4.motionToday')}</span>
      </div>
      <div className="rz-demo-stat-grid">
        <div data-beat="1300">
          <small>{t('landingV4.motionRecovered')}</small>
          <strong>{fmt.number(24)}</strong>
        </div>
        <div data-beat="1700">
          <small>{t('landingV4.motionToReview')}</small>
          <strong>{fmt.number(6)}</strong>
        </div>
      </div>
      <Status beat={2400}>{t('landingV4.motionTrace')}</Status>
    </Demo>
  );
}
