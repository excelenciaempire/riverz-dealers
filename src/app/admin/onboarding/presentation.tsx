'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Maximize2,
  Printer,
  Sparkles,
  X,
} from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { auditCases, brands, questions, scenarios, type Brand } from './data';
import styles from './presentation.module.css';

export function Onboarding({ brand }: { brand?: Brand }) {
  const t = useT();
  const [tab, setTab] = useState('map');
  const [group, setGroup] = useState(-1);
  const [selected, setSelected] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [client, setClient] = useState('');
  useEffect(() => {
    if (!presenting) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresenting(false);
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [presenting]);
  const applicable = scenarios.filter((s) => brand && s.brands.includes(brand));
  const visible = applicable.filter((s) => group < 0 || s.group === group);
  const active = visible.find((s) => s.id === selected) ?? visible[0];
  const questionnaire = questions.filter(
    (q) => brand && q.brands.includes(brand)
  );
  function download() {
    const payload = {
      brand,
      client,
      createdAt: new Date().toISOString(),
      decisions: questionnaire.map((q) => ({
        question: t(q.title),
        purpose: t(q.why),
        answer: answers[q.id] || t('onboarding.pending'),
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `riverz-onboarding-${brand}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={`${styles.root} ${presenting ? styles.presenting : ''}`}>
      <header className={styles.toolbar}>
        <Link href="/admin/onboarding" className={styles.wordmark}>
          riverz<span> / {t('onboarding.title')}</span>
        </Link>
        <div className={styles.actions}>
          {brand && (
            <button onClick={() => window.print()}>
              <Printer size={15} />
              {t('onboarding.print')}
            </button>
          )}
          <button onClick={() => setPresenting(!presenting)}>
            {presenting ? <X size={15} /> : <Maximize2 size={15} />}
            {t(`onboarding.${presenting ? 'exit' : 'present'}`)}
          </button>
        </div>
      </header>
      {brand && (
        <Link className={styles.back} href="/admin/onboarding">
          <ArrowLeft size={14} />
          {t('onboarding.back')}
        </Link>
      )}
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{t('onboarding.eyebrow')}</p>
          <h1>{t('onboarding.headline')}</h1>
          <p className={styles.intro}>{t('onboarding.intro')}</p>
        </div>
        {brand && (
          <aside className={styles.brandSeal}>
            <span>{t('onboarding.proposed')}</span>
            <strong>{client || t(`onboarding.${brand}`)}</strong>
            <p>{t(`onboarding.${brand}Desc`)}</p>
          </aside>
        )}
      </section>
      {!brand ? (
        <div className={styles.brandGrid}>
          {brands.map((b, i) => (
            <Link
              key={b}
              href={`/admin/onboarding/${b}`}
              className={styles.brandCard}
            >
              <span className={styles.eyebrow}>0{i + 1}</span>
              <h2>{t(`onboarding.${b}`)}</h2>
              <p>{t(`onboarding.${b}Desc`)}</p>
              <span className={styles.open}>
                {t('onboarding.open')}
                <ArrowRight size={18} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <>
          <nav className={styles.tabs} aria-label={t('onboarding.title')}>
            {['map', 'audit', 'questions'].map((view) => (
              <button
                key={view}
                aria-pressed={tab === view}
                onClick={() => setTab(view)}
              >
                {t(`onboarding.${view}`)}
              </button>
            ))}
          </nav>
          {tab === 'map' && (
            <>
              <div className={styles.sectionTitle}>
                <p className={styles.eyebrow}>{t(`onboarding.${brand}`)}</p>
                <h2>{t('onboarding.scope')}</h2>
                <p>{t(`onboarding.${brand}Focus`)}</p>
              </div>
              <section
                className={styles.canvas}
                aria-label={t('onboarding.map')}
              >
                <div className={styles.sources}>
                  <span>{t('onboarding.sources')}</span>
                  <span>{t('onboarding.systems')}</span>
                </div>
                <div className={styles.spine}>
                  <ArrowDown size={20} />
                </div>
                <div className={styles.hub}>
                  <Sparkles size={24} />
                  <div>
                    <h3>{t('onboarding.hub')}</h3>
                    <p>{t('onboarding.hubDesc')}</p>
                  </div>
                </div>
                <div className={styles.spine}>
                  <ArrowDown size={20} />
                </div>
                <div className={styles.lanes}>
                  {[0, 1, 2, 3, 4].map((g) => (
                    <div className={styles.lane} key={g}>
                      <button
                        className={styles.laneTitle}
                        onClick={() => {
                          setGroup(g);
                          setSelected(null);
                        }}
                      >
                        <span>0{g + 1}</span>
                        {t(`onboarding.step${g}`)}
                      </button>
                      {applicable
                        .filter((s) => s.group === g)
                        .map((s) => (
                          <button
                            key={s.id}
                            className={`${styles.node} ${active?.id === s.id ? styles.activeNode : ''}`}
                            onClick={() => {
                              setGroup(g);
                              setSelected(s.id);
                            }}
                          >
                            <span>{t(s.title)}</span>
                            <ArrowRight size={13} />
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
                <div className={styles.returnLine}>
                  <ArrowDown size={18} />
                  <p>{t('onboarding.guard')}</p>
                </div>
                <div className={styles.handoff}>
                  <Check size={20} />
                  <div>
                    <h3>{t('onboarding.human')}</h3>
                    <p>{t('onboarding.humanDesc')}</p>
                  </div>
                </div>
              </section>
              <section className={styles.explorer}>
                <div className={styles.filters}>
                  <button
                    aria-pressed={group === -1}
                    onClick={() => setGroup(-1)}
                  >
                    {t('onboarding.all')}
                  </button>
                  {[0, 1, 2, 3, 4].map((g) => (
                    <button
                      key={g}
                      aria-pressed={group === g}
                      onClick={() => setGroup(g)}
                    >
                      {t(`onboarding.step${g}`)}
                    </button>
                  ))}
                </div>
                <div className={styles.explorerGrid}>
                  <div className={styles.caseList}>
                    {visible.map((s) => (
                      <button
                        key={s.id}
                        aria-pressed={active?.id === s.id}
                        onClick={() => setSelected(s.id)}
                      >
                        {t(s.title)}
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </div>
                  {active && (
                    <article className={styles.caseDetail} aria-live="polite">
                      <p className={styles.eyebrow}>
                        {t('onboarding.proposed')}
                      </p>
                      <h3>{t(active.title)}</h3>
                      <div className={styles.flow}>
                        {(['trigger', 'action', 'exception'] as const).map(
                          (field, i) => (
                            <div key={field}>
                              <span className={styles.flowNumber}>
                                0{i + 1}
                              </span>
                              <section>
                                <h4>
                                  {t(
                                    `onboarding.${['when', 'action', 'exception'][i]}`
                                  )}
                                </h4>
                                <p>{t(active[field])}</p>
                              </section>
                            </div>
                          )
                        )}
                      </div>
                      <div className={styles.decision}>
                        <strong>{t('onboarding.decision')}</strong>
                        <p>{t(active.question)}</p>
                      </div>
                    </article>
                  )}
                </div>
              </section>
            </>
          )}
          {tab === 'audit' && (
            <section className={styles.audit}>
              <h2>{t('onboarding.audit')}</h2>
              <p className={styles.note}>{t('onboarding.snapshot')}</p>
              {brand === 'contraentrega' && (
                <p className={styles.decision}>{t('onboarding.notAudited')}</p>
              )}
              <div className={styles.readiness}>
                {brands.map((b) => (
                  <article key={b}>
                    <h3>{t(`onboarding.${b}`)}</h3>
                    <p>{t(`onboarding.${b}Gap`)}</p>
                  </article>
                ))}
              </div>
              {auditCases.map((c) => (
                <details key={c.id}>
                  <summary>
                    {t(c.title)}
                    <span>+</span>
                  </summary>
                  <div className={styles.comparison}>
                    {(['pilar', 'rasmiaw'] as const).map((b) => (
                      <article key={b}>
                        <h3>{t(`onboarding.${b}`)}</h3>
                        <p className={styles.status}>
                          {t(
                            c[b === 'pilar' ? 'pilarStatus' : 'rasmiawStatus']
                          )}
                        </p>
                        <ol>
                          {c[b].map((key) => (
                            <li key={key}>{t(key)}</li>
                          ))}
                        </ol>
                      </article>
                    ))}
                  </div>
                  <p className={styles.difference}>
                    <strong>{t('onboarding.difference')}: </strong>
                    {t(c.difference)}
                  </p>
                </details>
              ))}
            </section>
          )}
          {tab === 'questions' && (
            <section className={styles.questionnaire}>
              <h2>{t('onboarding.questions')}</h2>
              <p>{t('onboarding.qIntro')}</p>
              <div className={styles.questionToolbar}>
                <label>
                  {t('onboarding.client')}
                  <input
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    maxLength={120}
                  />
                </label>
                <button onClick={download}>
                  <Download size={16} />
                  {t('onboarding.export')}
                </button>
              </div>
              <p className={styles.note}>{t('onboarding.answerHint')}</p>
              <div className={styles.questionGrid}>
                {questionnaire.map((q, i) => (
                  <article key={q.id}>
                    <span className={styles.eyebrow}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <h3>{t(q.title)}</h3>
                    <p>{t(q.why)}</p>
                    <label htmlFor={q.id}>{t('onboarding.answer')}</label>
                    <textarea
                      id={q.id}
                      value={answers[q.id] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      rows={3}
                      maxLength={5000}
                    />
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <section className={styles.delivery}>
        <h2>{t('onboarding.deliveryTitle')}</h2>
        <div>
          {[1, 2, 3, 4].map((n) => (
            <article key={n}>
              <h3>{t(`onboarding.delivery${n}`)}</h3>
              <p>{t(`onboarding.delivery${n}Desc`)}</p>
            </article>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>
        <strong>riverz</strong>
        <span>{t('onboarding.eyebrow')}</span>
      </footer>
    </div>
  );
}
