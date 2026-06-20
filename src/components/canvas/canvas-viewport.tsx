'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ZoomIn, ZoomOut, Maximize2, AlignStartHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

/**
 * Scale + pan exposed to children so a draggable item inside the
 * canvas can convert client-coord mouse deltas into canvas-coord
 * position updates (dx_canvas = dx_client / scale).
 */
interface CanvasTransform {
  scale: number;
  tx: number;
  ty: number;
}
const CanvasTransformContext = createContext<CanvasTransform>({
  scale: 1,
  tx: 0,
  ty: 0,
});
export function useCanvasTransform(): CanvasTransform {
  return useContext(CanvasTransformContext);
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * Selectors a click on which should not start a pan — the user is
 * trying to interact with a control, not move the canvas.
 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a, label, [role="combobox"], [role="button"], [role="textbox"], [contenteditable="true"]';

/**
 * Shared pan + zoom viewport. Wraps any child layout — automations
 * uses it for the trigger/step flow; flows uses it for the node
 * chain. The child renders at whatever size it wants; the viewport
 * applies translate + scale so the user can pan with left-drag /
 * middle-mouse / trackpad, zoom with Ctrl + wheel, and fit to view
 * with the bottom-right "Centrar" button.
 *
 * Auto-centers the content on first paint (one rAF after mount) so
 * the first node isn't pinned against the left edge.
 */
/**
 * Handle imperativo expuesto por CanvasViewport. El editor de flujos lo
 * usa para hacer auto-zoom sobre un nodo cuando el usuario clickea en
 * un error del panel de validación.
 */
export interface CanvasViewportHandle {
  /** Centra y escala el viewport sobre un rect del lienzo (en coords del
   *  contenido, sin escalar). `targetScale` se clampa al rango permitido. */
  zoomToRect: (
    bounds: { x: number; y: number; w: number; h: number },
    targetScale?: number,
  ) => void;
}

interface CanvasViewportProps {
  children: React.ReactNode;
  className?: string;
  initialFit?: 'top-left' | 'fit';
  onComputeContentBounds?: () =>
    | { x: number; y: number; w: number; h: number }
    | null;
  /** Callback opcional. Si se provee, aparece un botón "Auto-organizar"
   *  en la barra de zoom que el usuario puede usar para reordenar
   *  todos los nodos en columnas tidy según el grafo del flujo. */
  onAutoLayout?: () => void;
}

export const CanvasViewport = forwardRef<CanvasViewportHandle, CanvasViewportProps>(
  function CanvasViewport(
    { children, className, initialFit = 'top-left', onComputeContentBounds, onAutoLayout },
    ref,
  ) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const hasCenteredRef = useRef(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ox = clientX - rect.left;
      const oy = clientY - rect.top;
      const next = clampScale(nextScale);
      const ratio = next / scale;
      setTx(ox - (ox - tx) * ratio);
      setTy(oy - (oy - ty) * ratio);
      setScale(next);
    },
    [scale, tx, ty],
  );

  // Auto-zoom imperativo. El editor de flujos lo dispara cuando el
  // usuario clickea "Ver error" en el panel de validación.
  useImperativeHandle(
    ref,
    () => ({
      zoomToRect: (bounds, targetScale = 1.2) => {
        const container = containerRef.current;
        if (!container) return;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const s = clampScale(targetScale);
        const cx = bounds.x + bounds.w / 2;
        const cy = bounds.y + bounds.h / 2;
        setScale(s);
        setTx(cw / 2 - cx * s);
        setTy(ch / 2 - cy * s);
      },
    }),
    [],
  );

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const padding = 80;
    const bounds = onComputeContentBounds?.() ?? null;
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      // El padre conoce la bbox real (ej. nodos en flow-builder). El
      // tx/ty arrastra la esquina top-left de la bbox al origen y la
      // centra dentro del container.
      const scaleFit = Math.min(
        1,
        (cw - padding) / bounds.w,
        (ch - padding) / bounds.h,
      );
      const s = clampScale(scaleFit);
      setScale(s);
      setTx((cw - bounds.w * s) / 2 - bounds.x * s);
      setTy((ch - bounds.h * s) / 2 - bounds.y * s);
      return;
    }
    const w = content.scrollWidth;
    const h = content.scrollHeight;
    if (!w || !h) return;
    const scaleFit = Math.min(1, (cw - padding) / w, (ch - padding) / h);
    const s = clampScale(scaleFit);
    setScale(s);
    setTx((cw - w * s) / 2);
    setTy((ch - h * s) / 2);
  }, [onComputeContentBounds]);

  useEffect(() => {
    if (hasCenteredRef.current) return;
    const id = requestAnimationFrame(() => {
      if (initialFit === 'fit') {
        fitToView();
      } else {
        // Arranca al 70% — la primera vez que abres el lienzo quieres ver
        // el conjunto del flujo, no un solo card al 100%. El usuario
        // hace zoom-in con Ctrl+rueda si quiere detalle de un nodo.
        setScale(0.7);
        setTx(40);
        setTy(40);
      }
      hasCenteredRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [fitToView, initialFit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(e.clientX, e.clientY, scale * factor);
      } else {
        e.preventDefault();
        setTx((v) => v - e.deltaX);
        setTy((v) => v - e.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, zoomAt]);

  // Pointer-based pan + pinch-zoom. Using Pointer Events (instead of the
  // old mouse-only handlers) makes the canvas work with touch and pen as
  // well as mouse — one finger pans, two fingers pinch-zoom — so the flow
  // editor is usable on a phone/tablet, not just desktop. `touch-action:
  // none` on the container (below) stops the browser from hijacking the
  // one-finger drag for page scroll. setPointerCapture keeps move/up events
  // coming even when the finger/cursor leaves the element, replacing the
  // old window-level mouse listeners.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    cx: number;
    cy: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    // Let taps/clicks on controls reach the control instead of panning.
    if (target.closest(INTERACTIVE_SELECTOR)) return;
    // Mouse: only left/middle button drags. Touch/pen always start.
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (pointersRef.current.size === 2) {
      // Second finger down → start a pinch, abandon the single-finger pan.
      dragRef.current = null;
      setDragging(false);
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    } else if (pointersRef.current.size === 1) {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty };
      setDragging(true);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.startDist > 0) {
        const ratio = dist / pinchRef.current.startDist;
        zoomAt(pinchRef.current.cx, pinchRef.current.cy, pinchRef.current.startScale * ratio);
      }
      return;
    }
    if (dragRef.current) {
      setTx(dragRef.current.startTx + (e.clientX - dragRef.current.startX));
      setTy(dragRef.current.startTy + (e.clientY - dragRef.current.startY));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  function zoomByButton(delta: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale + delta);
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // touch-action:none so one-finger drag pans the canvas instead of
      // scrolling the page, and two fingers pinch-zoom instead of zooming
      // the page. No effect with a mouse.
      style={{ touchAction: 'none' }}
      className={cn(
        'relative flex-1 overflow-hidden select-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--border) 1px, transparent 1px)',
          backgroundSize: `${20 * scale}px ${20 * scale}px`,
          backgroundPosition: `${tx}px ${ty}px`,
        }}
      />

      <div
        ref={contentRef}
        className="origin-top-left cursor-auto will-change-transform"
        style={{
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
        }}
      >
        <CanvasTransformContext.Provider value={{ scale, tx, ty }}>
          {children}
        </CanvasTransformContext.Provider>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 px-1 py-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => zoomByButton(-0.1)}
          className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
          title="Reducir (Ctrl + rueda)"
          aria-label="Reducir"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={fitToView}
          className="min-w-[3.5rem] rounded px-1 py-1 text-center text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Centrar y ajustar"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(0.1)}
          className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
          title="Ampliar (Ctrl + rueda)"
          aria-label="Ampliar"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          onClick={fitToView}
          className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
          title="Centrar todo el flujo"
          aria-label="Centrar"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        {onAutoLayout && (
          <button
            type="button"
            onClick={onAutoLayout}
            className="flex h-10 w-10 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:h-auto lg:w-auto lg:p-1.5"
            title="Reordenar nodos automáticamente"
            aria-label="Auto-organizar"
          >
            <AlignStartHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
});
