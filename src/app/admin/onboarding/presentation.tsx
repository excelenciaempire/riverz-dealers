'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  MessageCircle,
  Pencil,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { brands, questions, type Brand } from './data';
import { originals, templateSnapshotDate } from './original-templates';
import {
  currentCases,
  defaults,
  features,
  models,
  parseDraft,
  proposedCases,
  renderMessage,
  safeWebsite,
  templatesForCase,
  isCaseEnabled,
  proposedButtons,
  type PitchCase,
  type PitchDraft,
} from './pitch-data';
import styles from './presentation.module.css';
import { AutomationCanvas } from './automation-canvas';

export function Onboarding({ brand }: { brand?: Brand }) {
  const t = useT();
  if (!brand)
    return (
      <section className={styles.lobby}>
        <div className={styles.logo}>
          riverz<span> / {t('pitch.title')}</span>
        </div>
        <h1>{t('pitch.tagline')}</h1>
        <p>{t('pitch.intro')}</p>
        <div className={styles.brands}>
          {brands.map((b, i) => (
            <Link href={`/admin/onboarding/${b}`} key={b}>
              <span>0{i + 1}</span>
              <h2>
                {b === 'contraentrega' ? t('pitch.cod') : t(`pitch.${b}`)}
              </h2>
              <p>{t(`pitch.${b}Sector`)}</p>
              <strong>
                {t(
                  `pitch.${b === 'pilar' ? 'ctaPilar' : b === 'rasmiaw' ? 'ctaRasmiaw' : 'ctaCod'}`
                )}
                <ArrowRight size={18} />
              </strong>
            </Link>
          ))}
        </div>
      </section>
    );
  return <Studio key={brand} brand={brand} />;
}

function Studio({ brand }: { brand: Brand }) {
  const t = useT();
  const base = defaults[brand];
  const [draft, setDraft] = useState<PitchDraft>(() => ({
    version: 1,
    brand,
    name: base.name || t('pitch.contraentrega'),
    site: base.site,
    product: t(base.product),
    customer: 'María',
    amount: t('pitch.sampleAmount'),
    order: '#1042',
    model: base.model,
    features: {
      cart: true,
      discount: brand === 'rasmiaw',
      comments: true,
      aftercare: true,
      voice: false,
    },
    discount: 5,
    excluded: [],
    edits: {},
    answers: {},
    monthly: '',
    launch: '',
    owner: '',
    reviewed: false,
  }));
  const [tab, setTab] = useState('canvas');
  const [source, setSource] = useState(
    brand === 'contraentrega' ? 'design' : 'current'
  );
  const [group, setGroup] = useState(-1);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('audit-7');
  const [messageIndex, setMessageIndex] = useState(0);
  const [libraryId, setLibraryId] = useState('');
  const [example, setExample] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (settings) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [settings]);
  useEffect(() => {
    if (!presenting) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [presenting]);
  const actual = currentCases(brand);
  const proposals = proposedCases(draft);
  const all = [...actual, ...proposals];
  const available =
    tab === 'ai'
      ? all.filter((c) => c.ai)
      : source === 'current'
        ? actual
        : proposals;
  const filtered = available.filter(
    (c) =>
      (group === -1 || c.group === group) &&
      t(c.title).toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
  const active = filtered.find((c) => c.id === selected) ?? filtered[0];
  const library = (originals[brand] ?? []).filter((m) =>
    (m.name + ' ' + m.body)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
  const libraryMessage = library.find((m) => m.id === libraryId) ?? library[0];
  const messages = active ? templatesForCase(brand, active) : [];
  const original =
    tab === 'messages'
      ? libraryMessage
      : messages[Math.min(messageIndex, Math.max(0, messages.length - 1))];
  const messageKey = original?.id ?? active?.id ?? '';
  const originalBody =
    original?.body ?? (active?.example ? t(`pitch.msg_${active.example}`) : '');
  const body = draft.edits[messageKey] ?? originalBody;
  const hasMessage = Boolean(original || active?.example);
  const included = all.filter(
    (c) => isCaseEnabled(c, draft) && !draft.excluded.includes(c.id)
  );
  const questionnaire = questions.filter(
    (q) =>
      q.brands.includes(brand) ||
      (draft.model !== 'prepaid' && q.brands.includes('contraentrega'))
  );
  const questionPosition = Math.min(questionIndex, questionnaire.length - 1);
  const question = questionnaire[questionPosition];
  const website = safeWebsite(draft.site);
  const values: Record<string, string> = {
    brand: draft.name,
    site: draft.site || '[website]',
    product: draft.product,
    customer: draft.customer,
    amount: draft.amount,
    order: draft.order,
    discount: String(draft.discount),
    address: t('pitch.sampleAddress'),
    tracking: t('pitch.sampleUrl'),
    checkout: '[checkout]',
  };
  if (original) {
    for (const [key, binding] of Object.entries(original.variables))
      values[key] = /tracking/.test(binding)
        ? t('pitch.sampleUrl')
        : /order_name/.test(binding)
          ? draft.order
          : /total_price/.test(binding)
            ? draft.amount
            : /name/.test(binding)
              ? draft.customer
              : binding;
    if (/tracking|envio/.test(original.name))
      values['1'] = t('pitch.sampleUrl');
  }
  const rendered = !original || example ? renderMessage(body, values) : body;
  const update = (patch: Partial<PitchDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));
  function choose(c: PitchCase) {
    setSelected(c.id);
    setMessageIndex(0);
    setEditing(false);
    setNotice('');
  }
  function toggleIncluded(id: string) {
    update({
      excluded: draft.excluded.includes(id)
        ? draft.excluded.filter((x) => x !== id)
        : [...draft.excluded, id],
    });
  }
  function download() {
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      templateSnapshotDate,
      draft,
      scope: included.map((c) => ({
        id: c.id,
        title: t(c.title),
        source: c.source,
        proposedButtons: proposedButtons(c.example).map((k) => t(k)),
        path: c.path.map((k) => t(k)),
        messages: templatesForCase(brand, c).map((m) => ({
          name: m.name,
          originalBody: m.body,
          body: draft.edits[m.id] ?? m.body,
          edited: draft.edits[m.id] !== undefined,
          requiresTemplateApproval: draft.edits[m.id] !== undefined,
          header: m.header,
          footer: m.footer,
          buttons: m.buttons,
        })),
        example: c.example
          ? renderMessage(
              draft.edits[c.id] ?? t(`pitch.msg_${c.example}`),
              values
            )
          : null,
      })),
      decisions: questionnaire.map((q) => ({
        question: t(q.title),
        answer: draft.answers[q.id] ?? '',
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `riverz-propuesta-${brand}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(rendered);
      setNotice(t('pitch.copied'));
    } catch {
      setNotice(t('pitch.copyError'));
    }
  }
  const caseList = (
    <aside className={styles.list} aria-label={t('pitch.flows')}>
      <div className={styles.listHeading}>
        {t(tab === 'ai' ? 'pitch.ai' : 'pitch.flows')}
        <span>{filtered.length}</span>
      </div>
      {filtered.length === 0 && (
        <p className={styles.empty}>{t('pitch.noResults')}</p>
      )}
      {filtered.map((c) => (
        <button
          className={styles.caseButton}
          aria-pressed={c.id === active?.id}
          key={c.id}
          onClick={() => choose(c)}
        >
          <span className={styles.caseDot} data-kind={c.source} />
          <span>
            {t(c.title).replace(/^\d+ · /, '')}
            <small>{t(`pitch.${c.source}`)}</small>
          </span>
          <ChevronRight size={13} />
        </button>
      ))}
    </aside>
  );
  const phone = (
    <aside className={styles.messagePanel} aria-label={t('pitch.messages')}>
      <div className={styles.panelHeading}>
        <MessageCircle size={16} />
        <strong>{draft.name}</strong>
        <span>
          {t(
            original
              ? 'pitch.original'
              : active?.example === 'voice'
                ? 'pitch.voiceScript'
                : ['collection', 'deliveryfailure'].includes(
                      active?.example ?? ''
                    )
                  ? 'pitch.internalMessage'
                  : 'pitch.proposal'
          )}
        </span>
      </div>
      {hasMessage ? (
        <>
          {original && (
            <div className={styles.messageMode}>
              <button aria-pressed={!example} onClick={() => setExample(false)}>
                {t('pitch.original')}
              </button>
              <button aria-pressed={example} onClick={() => setExample(true)}>
                {t('pitch.example')}
              </button>
            </div>
          )}
          {original && (
            <div className={styles.templateName}>
              {original.name}
              <small>{t(`pitch.${original.usage}`)}</small>
            </div>
          )}
          <div className={styles.chat}>
            {tab === 'ai' &&
              active?.example &&
              [
                'catalog',
                'comments',
                'checkout',
                'privacy',
                'health',
                'tracking',
                'returns',
                'handoff',
                'pickup',
              ].includes(active.example) && (
                <div className={styles.inbound}>
                  {t(`pitch.prompt_${active.example}`)}
                </div>
              )}
            <div className={styles.bubble}>
              {original?.header && <strong>{original.header}</strong>}
              {editing ? (
                <textarea
                  aria-label={t('pitch.edit')}
                  value={body}
                  onChange={(e) =>
                    update({
                      edits: { ...draft.edits, [messageKey]: e.target.value },
                    })
                  }
                  maxLength={10000}
                />
              ) : (
                <p>{rendered}</p>
              )}
              {original?.footer && <small>{original.footer}</small>}
              {(original?.buttons ?? []).map((b, i) => (
                <div
                  className={styles.chatButton}
                  key={i}
                  title={b.url || b.type}
                >
                  {b.text}
                  {b.type === 'URL' && <ExternalLink size={12} />}
                </div>
              ))}
              {original && example && <small>{t('pitch.example')}</small>}
              {!original &&
                proposedButtons(active?.example ?? null).map((key) => (
                  <div className={styles.chatButton} key={key}>
                    {t(key)}
                  </div>
                ))}
            </div>
          </div>
          <div className={styles.messageActions}>
            <button onClick={copy}>
              <Copy size={13} />
              {t('pitch.copy')}
            </button>
            <button aria-pressed={editing} onClick={() => setEditing(!editing)}>
              <Pencil size={13} />
              {t('pitch.edit')}
            </button>
          </div>
          {draft.edits[messageKey] !== undefined && (
            <button
              className={styles.restore}
              onClick={() => {
                const edits = { ...draft.edits };
                delete edits[messageKey];
                update({ edits });
                setEditing(false);
              }}
            >
              {t('pitch.restore')}
            </button>
          )}
          <p className={styles.disclaimer}>
            {t(
              draft.edits[messageKey] !== undefined
                ? 'pitch.editedNote'
                : original
                  ? 'pitch.originalNote'
                  : 'pitch.proposalNote'
            )}
          </p>
        </>
      ) : (
        <div className={styles.noMessage}>
          <Workflow size={32} />
          <h3>{t('pitch.noMessage')}</h3>
          <p>{t('pitch.noMessageDesc')}</p>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </aside>
  );
  return (
    <section
      className={`${styles.studio} ${presenting ? styles.presenting : ''}`}
    >
      <header className={styles.topbar}>
        <Link className={styles.logo} href="/admin/onboarding">
          riverz<span> / {t('pitch.title')}</span>
        </Link>
        <div className={styles.toolbar}>
          <button onClick={() => setSettings(true)}>
            <Settings2 size={14} />
            {t('pitch.settings')}
          </button>
          <button onClick={download}>
            <Download size={14} />
            {t('pitch.download')}
          </button>
          <button onClick={() => setPresenting(!presenting)}>
            {presenting ? <X size={14} /> : <Maximize2 size={14} />}
            <span>{t(presenting ? 'pitch.exit' : 'pitch.present')}</span>
          </button>
        </div>
      </header>
      <div className={styles.brandbar}>
        <div className={styles.monogram}>
          {draft.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1>{draft.name}</h1>
          <p>
            {t(`pitch.${brand}Sector`)}
            {website && (
              <>
                {' '}
                ·{' '}
                <a href={website} target="_blank" rel="noreferrer">
                  {new URL(website).hostname}
                  <ExternalLink size={10} />
                </a>
              </>
            )}
          </p>
        </div>
        <div className={styles.model}>
          <span>{t('pitch.model')}</span>
          <div>
            {models.map((m) => (
              <button
                key={m}
                aria-pressed={draft.model === m}
                onClick={() => {
                  update({ model: m });
                  setSource('design');
                  setGroup(-1);
                  setTab('flows');
                }}
              >
                {t(`pitch.${m}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <nav className={styles.tabs} aria-label={t('pitch.title')}>
        {['canvas', 'overview', 'flows', 'messages', 'ai', 'agreement'].map(
          (view) => (
            <button
              key={view}
              aria-pressed={tab === view}
              onClick={() => {
                setTab(view);
                setQuery('');
                setGroup(-1);
                setEditing(false);
                setNotice('');
              }}
            >
              {t(`pitch.${view}`)}
              {view === 'messages' && (
                <span>
                  {brand === 'contraentrega'
                    ? proposals.length
                    : (originals[brand] ?? []).length}
                </span>
              )}
            </button>
          )
        )}
      </nav>
      {tab === 'canvas' && (
        <AutomationCanvas
          brand={brand}
          cases={[
            ...actual,
            ...proposedCases({
              ...draft,
              features: {
                cart: true,
                discount: true,
                comments: true,
                aftercare: true,
                voice: true,
              },
            }),
          ]}
          draft={draft}
          values={values}
        />
      )}
      {['flows', 'ai', 'messages'].includes(tab) && (
        <div className={styles.filters}>
          {tab === 'flows' && (
            <div className={styles.segment}>
              {['current', 'design'].map((s) => (
                <button
                  key={s}
                  disabled={brand === 'contraentrega' && s === 'current'}
                  aria-pressed={source === s}
                  onClick={() => {
                    setSource(s);
                    setGroup(-1);
                    setQuery('');
                  }}
                >
                  {t(`pitch.${s}`)}
                </button>
              ))}
            </div>
          )}
          {tab !== 'messages' && (
            <select
              aria-label={t('pitch.map')}
              value={group}
              onChange={(e) => setGroup(Number(e.target.value))}
            >
              <option value={-1}>{t('pitch.all')}</option>
              {[0, 1, 2, 3, 4].map((g) => (
                <option key={g} value={g}>
                  {t(`onboarding.step${g}`)}
                </option>
              ))}
            </select>
          )}
          <label className={styles.search}>
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('pitch.search')}
              aria-label={t('pitch.search')}
            />
          </label>
        </div>
      )}
      {(['flows', 'ai'].includes(tab) ||
        (tab === 'messages' && brand === 'contraentrega')) && (
        <div className={styles.workbench}>
          {caseList}
          <main className={styles.canvas}>
            {active ? (
              <>
                <div className={styles.caseHeading}>
                  <span className={styles.badge} data-kind={active.source}>
                    {t(`pitch.${active.source}`)}
                  </span>
                  <button
                    className={styles.include}
                    aria-pressed={
                      isCaseEnabled(active, draft) &&
                      !draft.excluded.includes(active.id)
                    }
                    disabled={!isCaseEnabled(active, draft)}
                    onClick={() => toggleIncluded(active.id)}
                  >
                    <Check size={13} />
                    {t(
                      !isCaseEnabled(active, draft) ||
                        draft.excluded.includes(active.id)
                        ? 'pitch.include'
                        : 'pitch.selected'
                    )}
                  </button>
                </div>
                <h2>{t(active.title).replace(/^\d+ · /, '')}</h2>
                <div className={styles.path}>
                  {active.path.map((key, i) => (
                    <div className={styles.pathStep} key={key}>
                      <div className={styles.pathNumber}>{i + 1}</div>
                      <article>
                        <small>
                          {t(
                            i === 0
                              ? 'pitch.when'
                              : i === 1
                                ? 'pitch.then'
                                : 'pitch.branches'
                          )}
                        </small>
                        <p>{t(key)}</p>
                      </article>
                      {i < active.path.length - 1 && (
                        <ArrowDown className={styles.pathArrow} size={15} />
                      )}
                    </div>
                  ))}
                </div>
                {messages.length > 0 && (
                  <div className={styles.sequence}>
                    <h3>{t('pitch.cadence')}</h3>
                    {messages.map((m, i) => (
                      <button
                        aria-pressed={
                          i === Math.min(messageIndex, messages.length - 1)
                        }
                        key={m.id}
                        onClick={() => {
                          setMessageIndex(i);
                          setEditing(false);
                        }}
                      >
                        <span>{i + 1}</span>
                        {m.name}
                        <ChevronRight size={13} />
                      </button>
                    ))}
                  </div>
                )}
                {active.question && (
                  <div className={styles.decision}>
                    <strong>{t('onboarding.decision')}</strong>
                    <p>{t(active.question)}</p>
                  </div>
                )}
              </>
            ) : (
              <p className={styles.empty}>{t('pitch.noResults')}</p>
            )}
          </main>
          {phone}
        </div>
      )}
      {tab === 'messages' && brand !== 'contraentrega' && (
        <div className={styles.workbench}>
          <aside className={styles.list}>
            <div className={styles.listHeading}>
              {t('pitch.library')}
              <span>{library.length}</span>
            </div>
            {library.map((m, i) => (
              <button
                className={styles.caseButton}
                aria-pressed={m.id === libraryMessage?.id}
                key={m.id}
                onClick={() => {
                  setLibraryId(m.id);
                  setEditing(false);
                }}
              >
                <span className={styles.caseDot} data-kind={m.usage} />
                <span>
                  {m.name}
                  <small>
                    {t(`pitch.${m.usage}`)} · {t('pitch.variant')} {i + 1}
                  </small>
                </span>
              </button>
            ))}
            {!library.length && (
              <p className={styles.empty}>{t('pitch.noTemplates')}</p>
            )}
          </aside>
          <main className={styles.canvas}>
            {libraryMessage && (
              <>
                <span className={styles.badge}>
                  {t(`pitch.${libraryMessage.usage}`)}
                </span>
                <h2>{libraryMessage.name}</h2>
                <section className={styles.metadata}>
                  <h3>{t('pitch.usage')}</h3>
                  {libraryMessage.flows.length ? (
                    libraryMessage.flows.map((f) => <p key={f}>{f}</p>)
                  ) : (
                    <p>{t('pitch.available')}</p>
                  )}
                  <h3>{t('pitch.templateStatus')}</h3>
                  <p>
                    {libraryMessage.metaStatus} · {libraryMessage.language}
                  </p>
                  <h3>{t('pitch.variables')}</h3>
                  {Object.entries(libraryMessage.variables).map(([k, v]) => (
                    <p key={k}>
                      <code>{`{{${k}}}`}</code> →{' '}
                      {v.replace(/\{\{vars\.|\}\}/g, '')}
                    </p>
                  ))}
                  <h3>{t('pitch.buttons')}</h3>
                  {libraryMessage.buttons.map((b, i) => (
                    <p key={i}>
                      {b.text}
                      <small>{b.urlVariable || b.type}</small>
                    </p>
                  ))}
                  <p className={styles.disclaimer}>{t('pitch.reviewClaims')}</p>
                </section>
              </>
            )}
          </main>
          {libraryMessage ? (
            phone
          ) : (
            <aside className={styles.messagePanel}>
              <p className={styles.empty}>{t('pitch.noTemplates')}</p>
            </aside>
          )}
        </div>
      )}
      {tab === 'overview' && (
        <main className={styles.overview}>
          <div className={styles.promise}>
            <Sparkles size={26} />
            <div>
              <h2>{t('pitch.allDone')}</h2>
              <p>{t('pitch.allDoneDesc')}</p>
            </div>
          </div>
          <div className={styles.stats}>
            <div>
              <strong>{all.length}</strong>
              {t('pitch.statCases')}
            </div>
            <div>
              <strong>{(originals[brand] ?? []).length}</strong>
              {t('pitch.statTemplates')}
            </div>
            <div>
              <strong>{included.length}</strong>
              {t('pitch.statIncluded')}
            </div>
          </div>
          <div className={styles.featureRow}>
            {features.map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={draft.features[f]}
                  onChange={(e) =>
                    update({
                      features: { ...draft.features, [f]: e.target.checked },
                    })
                  }
                />
                {t(`pitch.${f}`)}
              </label>
            ))}
          </div>
          <div className={styles.journey}>
            {[0, 1, 2, 3, 4].map((g) => (
              <button
                key={g}
                onClick={() => {
                  setTab('flows');
                  setSource(brand === 'contraentrega' ? 'design' : 'current');
                  setGroup(g);
                }}
              >
                <span>0{g + 1}</span>
                <h3>{t(`onboarding.step${g}`)}</h3>
                <small>
                  {all.filter((c) => c.group === g).length}{' '}
                  {t('pitch.statCases')}
                </small>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
          <div className={styles.overviewBottom}>
            <div>
              <h3>{t('pitch.handoff')}</h3>
              <p>{t('pitch.handoffNote')}</p>
            </div>
            <button onClick={() => setTab('agreement')}>
              {t('pitch.agreement')}
              <ArrowRight size={16} />
            </button>
          </div>
          <p className={styles.disclaimer}>{t('pitch.sourceModel')}</p>
        </main>
      )}
      {tab === 'agreement' && (
        <main className={styles.agreement}>
          <section className={styles.agreementScope}>
            <h2>{t('pitch.summary')}</h2>
            <div className={styles.featureRow}>
              {features.map((f) => (
                <label key={f}>
                  <input
                    type="checkbox"
                    checked={draft.features[f]}
                    onChange={(e) =>
                      update({
                        features: { ...draft.features, [f]: e.target.checked },
                      })
                    }
                  />
                  {t(`pitch.${f}`)}
                </label>
              ))}
            </div>
            <label>
              {t('pitch.discountValue')}
              <input
                type="number"
                min={0}
                max={100}
                value={draft.discount}
                onChange={(e) =>
                  update({
                    discount: Math.min(
                      100,
                      Math.max(0, Number(e.target.value))
                    ),
                  })
                }
              />
            </label>
            {brand === 'pilar' && draft.features.discount && (
              <p className={styles.disclaimer}>{t('pitch.noDiscount')}</p>
            )}
            <div className={styles.scopeList}>
              {all.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={
                      isCaseEnabled(c, draft) && !draft.excluded.includes(c.id)
                    }
                    disabled={!isCaseEnabled(c, draft)}
                    onChange={() => toggleIncluded(c.id)}
                  />
                  <span>
                    {t(c.title).replace(/^\d+ · /, '')}
                    <small>{t(`pitch.${c.source}`)}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>
          <section className={styles.question}>
            <div className={styles.questionTop}>
              <strong>{t('pitch.questions')}</strong>
              <span>
                {questionPosition + 1} / {questionnaire.length}
              </span>
            </div>
            <h2>{t(question.title)}</h2>
            <p>{t(question.why)}</p>
            <textarea
              aria-label={t('pitch.answer')}
              placeholder={t('pitch.answer')}
              value={draft.answers[question.id] ?? ''}
              maxLength={5000}
              onChange={(e) =>
                update({
                  answers: { ...draft.answers, [question.id]: e.target.value },
                })
              }
            />
            <div className={styles.questionNav}>
              <button
                disabled={questionPosition === 0}
                onClick={() => setQuestionIndex(questionPosition - 1)}
              >
                <ChevronLeft size={15} />
                {t('pitch.previous')}
              </button>
              <button
                disabled={questionPosition === questionnaire.length - 1}
                onClick={() => setQuestionIndex(questionPosition + 1)}
              >
                {t('pitch.next')}
                <ChevronRight size={15} />
              </button>
            </div>
            <div className={styles.commercial}>
              {(['owner', 'monthly', 'launch'] as const).map((field) => (
                <label key={field}>
                  {t(`pitch.${field}`)}
                  <input
                    value={draft[field]}
                    onChange={(e) => update({ [field]: e.target.value })}
                    maxLength={300}
                  />
                </label>
              ))}
            </div>
            <label className={styles.reviewed}>
              <input
                type="checkbox"
                checked={draft.reviewed}
                onChange={(e) => update({ reviewed: e.target.checked })}
              />
              {t('pitch.reviewed')}
            </label>
            <button className={styles.primary} onClick={download}>
              <Download size={15} />
              {t('pitch.download')}
            </button>
            <p className={styles.disclaimer}>{t('pitch.handoffNote')}</p>
          </section>
        </main>
      )}
      <footer className={styles.footer}>
        <span>{t('pitch.draftNotice')}</span>
        <button onClick={() => importRef.current?.click()}>
          <Upload size={12} />
          {t('pitch.import')}
        </button>
        <input
          ref={importRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 500000) throw new Error('invalid');
              setDraft(parseDraft(await file.text(), brand));
              setNotice('');
              setEditing(false);
            } catch {
              setNotice(t('pitch.importError'));
            }
            e.target.value = '';
          }}
        />
        {notice && !['flows', 'ai', 'messages'].includes(tab) && (
          <span role="status">{notice}</span>
        )}
      </footer>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onCancel={() => setSettings(false)}
      >
        <div className={styles.dialogHeading}>
          <h2>{t('pitch.customize')}</h2>
          <button
            aria-label={t('pitch.close')}
            onClick={() => setSettings(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className={styles.fields}>
          {(
            ['name', 'site', 'product', 'customer', 'amount', 'order'] as const
          ).map((field) => (
            <label key={field}>
              {t(`pitch.${field === 'name' ? 'brand' : field}`)}
              <input
                value={draft[field]}
                onChange={(e) => update({ [field]: e.target.value })}
                maxLength={500}
              />
            </label>
          ))}
        </div>
        <p className={styles.disclaimer}>{t('pitch.draftNotice')}</p>
        <button className={styles.primary} onClick={() => setSettings(false)}>
          <Check size={15} />
          {t('pitch.close')}
        </button>
      </dialog>
    </section>
  );
}
