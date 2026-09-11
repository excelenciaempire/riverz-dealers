'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Home,
  Maximize,
  MessageCircle,
  MoreHorizontal,
  Minus,
  Plus,
  Search,
  Timer,
  Zap,
} from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import type { Brand } from './data';
import type { PitchCase, PitchDraft } from './pitch-data';
import { buildCanvas, NODE_WIDTH, type MapNode } from './canvas-graph';
import css from './automation-canvas.module.css';
import { horizontalEdge } from './horizontal-layout';
import { LINE_W } from '@/components/automations/canvas-geometry';
import { buildClientCanvas, journeyIds } from './client-journeys';
import { operationCatalog } from '@/lib/i18n/messages/pitch-operations';

export function AutomationCanvas({
  brand,
  cases,
  draft,
  values,
}: {
  brand: Brand;
  cases: PitchCase[];
  draft: PitchDraft;
  values: Record<string, string>;
}) {
  const t = useT();
  const [mode, setMode] = useState<'client' | 'technical'>('client');
  const [expanded, setExpanded] = useState<string[]>(
    journeyIds.map((id) => `journey-${id}`)
  );
  const pendingJourney = useRef<string | null>(null);
  const pendingInline = useRef<string | null>(null);
  const [routeChoices, setRouteChoices] = useState<Record<string, string>>({});
  const graph = useMemo(
    () =>
      mode === 'client'
        ? buildClientCanvas(
            brand,
            cases,
            draft,
            t,
            values,
            expanded,
            routeChoices
          )
        : buildCanvas(brand, cases, draft, t, values),
    [brand, cases, draft, t, values, mode, expanded, routeChoices]
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 30, y: 25, zoom: 0.6 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null
  );
  const initialized = useRef<string | null>(null);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const results = graph.nodes.filter(
    (n) =>
      !query ||
      `${n.title} ${n.body ?? ''} ${n.template ?? ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
  );
  const caseNodes =
    mode === 'client'
      ? graph.nodes.filter(
          (n) => n.kind === (expanded.length ? 'scenario' : 'journey')
        )
      : cases.map((c) => byId.get(c.id)).filter((n): n is MapNode => !!n);
  function focus(n: MapNode) {
    const childIds =
      n.kind === 'condition'
        ? graph.edges.filter((e) => e.from === n.id).map((e) => e.to)
        : [];
    const row = graph.nodes.filter(
      (item) =>
        item.id === n.id ||
        (n.kind === 'scenario' && item.id.startsWith(`${n.id}-`)) ||
        (n.kind === 'journey' &&
          !expanded.includes(n.id) &&
          item.id.startsWith(`${n.id}-`)) ||
        childIds.includes(item.id) ||
        item.id.startsWith(`${n.id}-path-`) ||
        item.id.startsWith(`${n.id}-message-`) ||
        item.id === `${n.id}-silent`
    );
    const top = Math.min(...row.map((item) => item.y));
    const width = Math.max(...row.map((item) => item.x + NODE_WIDTH)) - n.x;
    const zoom = Math.min(
      1,
      (size.height - 140) /
        (Math.max(...row.map((item) => item.y + item.height)) - top),
      (size.width - 80) / width
    );
    setView({
      zoom,
      x: size.width / 2 - (n.x + width / 2) * zoom,
      y: 85 - top * zoom,
    });
    setSelected(n.id);
  }
  function fit() {
    const zoom = Math.min(
      (size.width - 60) / graph.width,
      (size.height - 60) / graph.height,
      1
    );
    setView({ zoom, x: (size.width - graph.width * zoom) / 2, y: 30 });
  }
  function goToStart() {
    const first =
      graph.nodes.find((n) => n.kind === 'scenario') ??
      graph.nodes.find((n) => n.kind === 'journey') ??
      graph.nodes.find((n) => n.kind === 'trigger' && n.status === 'active') ??
      graph.nodes.find((n) => n.kind === 'hub');
    if (first)
      setView({ zoom: 0.75, x: 40 - first.x * 0.75, y: 85 - first.y * 0.75 });
  }
  function zoomAt(factor: number, x = size.width / 2, y = size.height / 2) {
    setView((v) => {
      const zoom = Math.max(0.012, Math.min(1.6, v.zoom * factor));
      return {
        zoom,
        x: x - ((x - v.x) * zoom) / v.zoom,
        y: y - ((y - v.y) * zoom) / v.zoom,
      };
    });
  }
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    );
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const x = e.clientX - rect.left,
          y = e.clientY - rect.top;
        setView((v) => {
          const zoom = Math.max(
            0.012,
            Math.min(1.6, v.zoom * Math.exp(-e.deltaY * 0.008))
          );
          return {
            zoom,
            x: x - ((x - v.x) * zoom) / v.zoom,
            y: y - ((y - v.y) * zoom) / v.zoom,
          };
        });
      } else
        setView((v) => ({
          ...v,
          x: v.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: v.y - (e.shiftKey ? 0 : e.deltaY),
        }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  useEffect(() => {
    if (size.height && pendingInline.current) {
      const origin = pendingInline.current;
      const children = graph.edges
        .filter((e) => e.from === origin)
        .map((e) => e.to);
      const branch = graph.nodes.filter(
        (n) =>
          n.id === origin ||
          n.id.startsWith(`${origin}-inline-`) ||
          children.includes(n.id)
      );
      if (branch.length) {
        const left = Math.min(...branch.map((n) => n.x));
        const top = Math.min(...branch.map((n) => n.y));
        const width = Math.max(...branch.map((n) => n.x + NODE_WIDTH)) - left;
        const height = Math.max(...branch.map((n) => n.y + n.height)) - top;
        const zoom = Math.min(
          0.8,
          (size.width - 80) / width,
          (size.height - 125) / height
        );
        setView({ zoom, x: 40 - left * zoom, y: 85 - top * zoom });
        setSelected(origin);
      }
      pendingInline.current = null;
      return;
    }
    if (
      !size.height ||
      (initialized.current === mode && !pendingJourney.current)
    )
      return;
    initialized.current = mode;
    const first =
      graph.nodes.find((n) => n.id === pendingJourney.current) ??
      graph.nodes.find((n) => n.kind === 'scenario') ??
      graph.nodes.find((n) => n.kind === 'journey') ??
      graph.nodes.find((n) => n.kind === 'trigger' && n.status === 'active') ??
      graph.nodes.find((n) => n.kind === 'hub');
    if (first)
      setView({ zoom: 0.75, x: 40 - first.x * 0.75, y: 85 - first.y * 0.75 });
    pendingJourney.current = null;
    if (first) setSelected(first.id);
  }, [graph, size.height, size.width, mode]);

  const miniScale = Math.min(180 / graph.width, 145 / graph.height);
  const miniWidth = graph.width * miniScale,
    miniHeight = graph.height * miniScale;
  const currentCase = caseNodes.findIndex(
    (n) => n.id === selected || selected.startsWith(`${n.id}-`)
  );
  const selectedSection = graph.sections.find(
    (s) => s.id === selected || selected.startsWith(`${s.id}-`)
  );
  return (
    <section className={css.canvas} aria-label={t('pitch.canvas')}>
      <div className={css.toolbar}>
        <details className={css.canvasMenu}>
          <summary aria-label={t('pitch.options')}>
            <MoreHorizontal size={18} />
          </summary>
          <div
            className={css.canvasMenuPanel}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button'))
                e.currentTarget.closest('details')?.removeAttribute('open');
            }}
          >
            <div className={css.mode}>
              {(['client', 'technical'] as const).map((view) => (
                <button
                  key={view}
                  aria-pressed={mode === view}
                  onClick={() => {
                    setMode(view);
                    setQuery('');
                    setSelected('');
                  }}
                >
                  {t(
                    view === 'client'
                      ? 'pitch.clientView'
                      : 'pitch.technicalView'
                  )}
                </button>
              ))}
            </div>
            {mode === 'client' && (
              <button
                className={css.expandJourney}
                onClick={() => {
                  const opening = expanded.length !== journeyIds.length;
                  pendingJourney.current = opening
                    ? 'operation-recommend'
                    : 'journey-advice';
                  setExpanded(
                    opening ? journeyIds.map((id) => `journey-${id}`) : []
                  );
                  setQuery('');
                }}
              >
                {t(
                  expanded.length === journeyIds.length
                    ? 'pitch.operationSummary'
                    : 'pitch.operationAll'
                )}
              </button>
            )}
            <button onClick={fit}>{t('pitch.viewMap')}</button>
          </div>
        </details>
        <select
          aria-label={t('pitch.explore')}
          value={selectedSection?.id ?? ''}
          onChange={(e) => {
            const section = graph.sections.find((s) => s.id === e.target.value);
            const node =
              byId.get(section?.id ?? '') ??
              byId.get((section?.id ?? '').replace('section-', 'group-'));
            if (node) focus(node);
          }}
        >
          <option value="">{t('pitch.explore')}</option>
          {mode === 'client' && expanded.length > 0 ? (
            <>
              {journeyIds.map((journey) => (
                <optgroup key={journey} label={t(`pitch.journey_${journey}`)}>
                  {operationCatalog
                    .filter(
                      (s) =>
                        s.journey === journey && byId.has(`operation-${s.id}`)
                    )
                    .map((s) => (
                      <option key={s.id} value={`operation-${s.id}`}>
                        {t(`pitch.operation_${s.id}_title`)}
                      </option>
                    ))}
                </optgroup>
              ))}
              <optgroup label={t('pitch.technicalView')}>
                {graph.sections
                  .filter((s) => byId.get(s.id)?.kind === 'trigger')
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.title}
                    </option>
                  ))}
              </optgroup>
            </>
          ) : (
            graph.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))
          )}
        </select>
        <button
          className={css.searchToggle}
          aria-label={t('pitch.canvasSearch')}
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen(!searchOpen);
            setQuery('');
          }}
        >
          <Search size={17} />
        </button>
        {searchOpen && (
          <label className={css.search}>
            <input
              autoFocus
              aria-label={t('pitch.canvasSearch')}
              placeholder={t('pitch.canvasSearch')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>
      <div
        ref={viewport}
        className={css.viewport}
        tabIndex={0}
        role="region"
        aria-label={t('pitch.canvasControls')}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('input,select,button,textarea'))
            return;
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
              '+',
              '=',
              '-',
              '0',
            ].includes(e.key)
          )
            e.preventDefault();
          if (e.key === '+' || e.key === '=') zoomAt(1.25);
          if (e.key === '-') zoomAt(0.8);
          if (e.key === '0') fit();
          const d = {
            ArrowLeft: [100, 0],
            ArrowRight: [-100, 0],
            ArrowUp: [0, 100],
            ArrowDown: [0, -100],
          }[e.key];
          if (d) setView((v) => ({ ...v, x: v.x + d[0], y: v.y + d[1] }));
        }}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            (e.target as HTMLElement).closest('article,button,input,select')
          )
            return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            vx: viewRef.current.x,
            vy: viewRef.current.y,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d)
            setView((v) => ({
              ...v,
              x: d.vx + e.clientX - d.x,
              y: d.vy + e.clientY - d.y,
            }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className={css.world}
          data-canvas-world
          style={{
            width: graph.width,
            height: graph.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          {graph.sections.map((s) => (
            <div
              className={css.section}
              key={s.id}
              style={{
                left: s.x - 20,
                top: s.y - 20,
                width: s.width + 40,
                height: s.height + 40,
              }}
            >
              <strong>{s.title}</strong>
            </div>
          ))}
          <svg
            className={css.edges}
            width={graph.width}
            height={graph.height}
            aria-hidden="true"
          >
            {graph.edges.map((e, i) => {
              const a = byId.get(e.from),
                b = byId.get(e.to);
              if (!a || !b) return null;
              const { path, labelX, labelY } = horizontalEdge(a, b, e);
              return (
                <g key={i} data-edge-from={e.from} data-edge-to={e.to}>
                  <path
                    d={path}
                    fill="none"
                    stroke="#626a73"
                    strokeWidth={LINE_W}
                    strokeDasharray={e.example ? '7 6' : undefined}
                  />
                  {e.label && (
                    <g transform={`translate(${labelX},${labelY})`}>
                      <rect
                        x="-40"
                        y="-12"
                        width="80"
                        height="24"
                        rx="12"
                        fill={
                          e.label === 'yes'
                            ? '#182b23'
                            : e.label === 'no'
                              ? '#302023'
                              : '#101113'
                        }
                        stroke={
                          e.label === 'yes'
                            ? '#3e7056'
                            : e.label === 'no'
                              ? '#805057'
                              : '#333940'
                        }
                      />
                      <text
                        textAnchor="middle"
                        y="5"
                        fontSize="13"
                        fill={
                          e.label === 'yes'
                            ? '#a9d7b8'
                            : e.label === 'no'
                              ? '#e2a6ae'
                              : '#aeb5bc'
                        }
                      >
                        {t(`pitch.canvas_${e.label}`)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((n) => {
            const Icon =
              n.kind === 'condition'
                ? GitBranch
                : n.kind === 'wait'
                  ? Timer
                  : n.kind === 'ai' || n.kind === 'voice_call'
                    ? Bot
                    : n.kind.startsWith('send_')
                      ? MessageCircle
                      : n.kind === 'end'
                        ? Check
                        : Zap;
            return (
              <article
                key={n.id}
                data-map-node={n.id}
                data-kind={n.kind}
                data-selected={selected === n.id}
                className={css.node}
                style={{
                  left: n.x,
                  top: n.y,
                  width: NODE_WIDTH,
                  minHeight: n.height,
                  opacity:
                    query && !results.some((r) => r.id === n.id) ? 0.35 : 1,
                }}
              >
                <header>
                  <Icon size={17} />
                  <span>
                    {n.caption ??
                      (n.status
                        ? t(`pitch.${n.status}`)
                        : t(
                            n.kind === 'end'
                              ? 'pitch.canvasResult'
                              : 'pitch.canvasStep'
                          ))}
                  </span>
                  <button
                    aria-label={`${t('pitch.canvasFocus')}: ${n.title}`}
                    onClick={() => focus(n)}
                  >
                    <Maximize size={15} />
                  </button>
                </header>
                <h3>{n.title}</h3>
                {n.template && (
                  <small className={css.template}>{n.template}</small>
                )}
                {n.body && (
                  <p
                    className={
                      n.kind.startsWith('send_') ? css.message : css.body
                    }
                  >
                    {n.body}
                  </p>
                )}
                {n.routes && (
                  <select
                    className={css.routeSelect}
                    value={routeChoices[n.id] ?? ''}
                    aria-label={t('pitch.operationOther')}
                    onChange={(e) => {
                      const choice = e.target.value;
                      pendingInline.current = n.id;
                      setRouteChoices((previous) => ({
                        ...Object.fromEntries(
                          Object.entries(previous).filter(
                            ([id]) => !id.startsWith(`${n.id}-inline-`)
                          )
                        ),
                        [n.id]: choice,
                      }));
                    }}
                  >
                    <option value="">{t('pitch.operationOther')}</option>
                    {n.routes.map((id) => (
                      <option value={id} key={id}>
                        {t(
                          `pitch.operation_${id.replace('operation-', '')}_title`
                        )}
                      </option>
                    ))}
                  </select>
                )}
                {!!n.buttons?.length && (
                  <div className={css.messageButtons}>
                    {n.buttons.map((b, i) => (
                      <span key={i}>{b}</span>
                    ))}
                  </div>
                )}
                {n.kind === 'journey' && (
                  <button
                    className={css.expandJourney}
                    aria-expanded={expanded.includes(n.id)}
                    onClick={() => {
                      pendingJourney.current = n.id;
                      setExpanded((items) =>
                        items.includes(n.id)
                          ? items.filter((id) => id !== n.id)
                          : [...items, n.id]
                      );
                    }}
                  >
                    {t(
                      expanded.includes(n.id)
                        ? 'pitch.clientCollapse'
                        : 'pitch.clientExpand'
                    )}
                    <ChevronRight size={14} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {query && (
          <div className={css.results}>
            <strong>
              {results.length} {t('pitch.canvasMatches')}
            </strong>
            {results.slice(0, 40).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  focus(n);
                  setQuery('');
                }}
              >
                {n.template || n.title}
              </button>
            ))}
          </div>
        )}
        <div className={css.legend}>
          <span>● {t('pitch.active')}</span>
          <span>
            ◌ {t('pitch.draft')} / {t('pitch.proposal')}
          </span>
          <span>┄ {t('pitch.canvas_example')}</span>
        </div>
        <div className={css.navigation}>
          <button
            aria-label={t('pitch.canvasStart')}
            title={t('pitch.canvasStart')}
            onClick={goToStart}
          >
            <Home size={17} />
          </button>
          <button
            aria-label={t('pitch.canvasPrevious')}
            onClick={() =>
              focus(
                caseNodes[
                  (currentCase - 1 + caseNodes.length) % caseNodes.length
                ]
              )
            }
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {Math.max(1, currentCase + 1)} / {caseNodes.length}
          </span>
          <button
            aria-label={t('pitch.canvasNext')}
            onClick={() =>
              focus(caseNodes[(currentCase + 1) % caseNodes.length])
            }
          >
            <ChevronRight size={17} />
          </button>
          <i />
          <button
            aria-label={t('pitch.canvasZoomOut')}
            onClick={() => zoomAt(0.8)}
          >
            <Minus size={17} />
          </button>
          <span>{Math.round(view.zoom * 100)}%</span>
          <button
            aria-label={t('pitch.canvasZoomIn')}
            onClick={() => zoomAt(1.25)}
          >
            <Plus size={17} />
          </button>
          <button
            aria-label={t('pitch.centerCase')}
            title={t('pitch.centerCase')}
            onClick={() => {
              const n = caseNodes[currentCase] ?? caseNodes[0];
              if (n) focus(n);
            }}
          >
            <Maximize size={17} />
          </button>
        </div>
        <button
          className={css.minimap}
          aria-label={t('pitch.canvasMinimap')}
          onClick={(e) => {
            const rect = e.currentTarget
              .querySelector('svg')!
              .getBoundingClientRect();
            setView((v) => ({
              ...v,
              x:
                size.width / 2 - ((e.clientX - rect.left) / miniScale) * v.zoom,
              y:
                size.height / 2 - ((e.clientY - rect.top) / miniScale) * v.zoom,
            }));
          }}
        >
          <svg
            width={miniWidth}
            height={miniHeight}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
          >
            {graph.sections.map((s) => (
              <rect
                key={s.id}
                x={s.x}
                y={s.y}
                width={s.width}
                height={s.height}
                fill="#dce4d8"
              />
            ))}
            {graph.nodes.map((n) => (
              <rect
                key={n.id}
                x={n.x}
                y={n.y}
                width={NODE_WIDTH}
                height={n.height}
                fill={n.kind.startsWith('send_') ? '#57896e' : '#a1b09c'}
              />
            ))}
            <rect
              x={-view.x / view.zoom}
              y={-view.y / view.zoom}
              width={size.width / view.zoom}
              height={size.height / view.zoom}
              fill="#e9f68b55"
              stroke="#345a43"
              strokeWidth={20}
            />
          </svg>
        </button>
      </div>
      <div className={css.footnote}>{t('pitch.canvasHint')}</div>
    </section>
  );
}
