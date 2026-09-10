'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Maximize,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Timer,
  Workflow,
  Zap,
} from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import type { Brand } from './data';
import type { PitchCase, PitchDraft } from './pitch-data';
import { buildCanvas, NODE_WIDTH, type MapNode } from './canvas-graph';
import css from './automation-canvas.module.css';

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
  const graph = useMemo(
    () => buildCanvas(brand, cases, draft, t, values),
    [brand, cases, draft, t, values]
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 30, y: 25, zoom: 0.6 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ width: 1000, height: 500 });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null
  );
  const initialized = useRef(false);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const results = graph.nodes.filter(
    (n) =>
      !query ||
      `${n.title} ${n.body ?? ''} ${n.template ?? ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
  );
  const caseNodes = cases
    .map((c) => byId.get(c.id))
    .filter((n): n is MapNode => !!n);
  function focus(n: MapNode) {
    const message = byId.get(`${n.id}-message-0`);
    const zoom = Math.min(
      1,
      (size.height - 100) / Math.max(n.height, message?.height ?? 0),
      (size.width - 60) / (message ? 820 : NODE_WIDTH)
    );
    setView({
      zoom,
      x: size.width / 2 - (n.x + (message ? 410 : NODE_WIDTH / 2)) * zoom,
      y: 40 - n.y * zoom,
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
    if (initialized.current || !size.height) return;
    initialized.current = true;
    const first =
      graph.nodes.find((n) => n.kind === 'trigger' && n.status === 'active') ??
      graph.nodes.find((n) => n.kind === 'hub');
    if (first)
      setView({ zoom: 0.65, x: 80 - first.x * 0.65, y: 50 - first.y * 0.65 });
  }, [graph, size.height]);

  const miniScale = Math.min(180 / graph.width, 145 / graph.height);
  const miniWidth = graph.width * miniScale,
    miniHeight = graph.height * miniScale;
  const currentCase = caseNodes.findIndex((n) => n.id === selected);
  return (
    <section className={css.canvas} aria-label={t('pitch.canvas')}>
      <div className={css.toolbar}>
        <span className={css.heading}>
          <Workflow size={17} />
          {t('pitch.canvas')}
        </span>
        <select
          aria-label={t('pitch.canvasNavigate')}
          value=""
          onChange={(e) => {
            const section = graph.sections.find((s) => s.id === e.target.value);
            const node =
              byId.get(section?.id ?? '') ??
              byId.get((section?.id ?? '').replace('section-', 'group-'));
            if (node) focus(node);
          }}
        >
          <option value="">{t('pitch.canvasNavigate')}</option>
          {graph.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <label className={css.search}>
          <Search size={15} />
          <input
            aria-label={t('pitch.canvasSearch')}
            placeholder={t('pitch.canvasSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className={css.count}>
          {graph.nodes.length} {t('pitch.canvasNodes')} · {cases.length}{' '}
          {t('pitch.canvasCases')}
        </span>
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
            <defs>
              <marker
                id="canvas-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8" fill="#8a9b90" />
              </marker>
            </defs>
            {graph.edges.map((e, i) => {
              const a = byId.get(e.from),
                b = byId.get(e.to);
              if (!a || !b) return null;
              const side = e.example && b.x > a.x + NODE_WIDTH;
              const x1 = a.x + (side ? NODE_WIDTH : NODE_WIDTH / 2),
                y1 = a.y + (side ? a.height / 2 : a.height);
              const x2 = b.x + (side ? 0 : NODE_WIDTH / 2),
                y2 = b.y + (side ? b.height / 2 : 0);
              const mid = (y1 + y2) / 2;
              let path = side
                ? `M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`
                : `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
              let labelX = side ? (x1 + x2) / 2 : (x1 + x2) / 2;
              let labelY = side ? (y1 + y2) / 2 : y1 + 30;
                if (a.id === 'brand') {
                  // Shared navigation bus stays outside every automation lane.
                  path = `M${a.x},${a.y + a.height / 2} H20 V${b.y - 25} H${b.x + NODE_WIDTH / 2} V${b.y}`;
                } else if (e.example && a.x === b.x && y2 - y1 > 110) {
                // Parallel scenarios share a left-side bus, never a line through
                // the intervening scenario cards.
                const bus = a.x - 55;
                path = `M${a.x},${a.y + a.height / 2} H${bus} V${b.y + b.height / 2} H${b.x}`;
              } else if (!e.example && y2 - y1 > 110) {
                // An empty branch may skip many steps before a join. Route it
                // around the lane instead of through those steps.
                const section = graph.sections.find((s) =>
                  a.id.startsWith(`${s.id}-step-`)
                );
                const bus = section
                  ? section.x + section.width - 12
                  : Math.max(a.x, b.x) + NODE_WIDTH + 55;
                const startY = a.y + a.height / 2,
                  endY = b.y + b.height / 2;
                path = `M${a.x + NODE_WIDTH},${startY} H${bus} V${endY} H${b.x + NODE_WIDTH}`;
                labelX = bus;
                labelY = startY + 25;
              }
              return (
                <g key={i} data-edge-from={e.from} data-edge-to={e.to}>
                  <path
                    d={path}
                    fill="none"
                    stroke={e.label === 'no' ? '#c39076' : '#8a9b90'}
                    strokeWidth={2}
                    strokeDasharray={e.example ? '7 6' : undefined}
                    markerEnd="url(#canvas-arrow)"
                  />
                  {e.label && (
                    <g transform={`translate(${labelX},${labelY})`}>
                      <rect
                        x="-40"
                        y="-12"
                        width="80"
                        height="24"
                        rx="12"
                        fill="#f5f3ec"
                      />
                      <text
                        textAnchor="middle"
                        y="5"
                        fontSize="13"
                        fill="#52675c"
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
                    {n.status
                      ? t(`pitch.${n.status}`)
                      : t(
                          n.kind === 'end'
                            ? 'pitch.canvasResult'
                            : 'pitch.canvasStep'
                        )}
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
                {!!n.buttons?.length && (
                  <div className={css.messageButtons}>
                    {n.buttons.map((b, i) => (
                      <span key={i}>{b}</span>
                    ))}
                  </div>
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
          <span>{t('pitch.canvasCases')}</span>
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
            aria-label={t('pitch.canvasFit')}
            title={t('pitch.canvasFit')}
            onClick={fit}
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
