"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizablePaneProps {
  /** Pane content. */
  children: React.ReactNode;
  /** localStorage key — separate per use-case so multiple resizable
   *  panes on different pages don't share the same width. */
  storageKey: string;
  /** Default width in px on first load. */
  defaultWidth: number;
  /** Hard limits on what the user can drag to. */
  minWidth?: number;
  maxWidth?: number;
  /** Whether the pane (and its drag handle) is hidden on small screens.
   *  Defaults to hiding below lg, matching how the inbox already swaps
   *  between single-pane and split layouts. */
  className?: string;
}

/**
 * Drag-to-resize wrapper used for the inbox conversation pane. Renders
 * an invisible 4px-wide handle on the right edge that becomes a grab
 * cursor on hover; dragging it sets the pane width and persists the
 * choice to localStorage.
 *
 * Width only applies at lg+ (where the inbox uses the split layout).
 * Below lg the pane occupies the whole viewport via existing Tailwind
 * classes on the inbox page, so resizing wouldn't make sense.
 */
export function ResizablePane({
  children,
  storageKey,
  defaultWidth,
  minWidth = 240,
  maxWidth = 600,
  className,
}: ResizablePaneProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  // Hydration guard: localStorage isn't available on the server and
  // reading it during the initial render would mismatch what the server
  // sent. Wait until the first effect runs to pull the stored value.
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          setWidth(Math.min(maxWidth, Math.max(minWidth, parsed)));
        }
      }
    } catch {
      // localStorage unavailable — fall back to default.
    }
    hydratedRef.current = true;
  }, [storageKey, minWidth, maxWidth]);

  const persist = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // No-op — see read above.
      }
    },
    [storageKey],
  );

  const paneRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = paneRef.current?.getBoundingClientRect().width ?? width;
      setDragging(true);

      // Disable user-select on the whole document so the drag doesn't
      // highlight text in the surrounding UI as the cursor moves.
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const next = Math.min(
          maxWidth,
          Math.max(minWidth, startWidth + delta),
        );
        setWidth(next);
      };
      const onUp = () => {
        setDragging(false);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Read the latest width from the DOM rather than closing over
        // the React state, which lags one render behind the last
        // pointermove during a fast drag.
        const finalWidth =
          paneRef.current?.getBoundingClientRect().width ?? startWidth;
        persist(Math.round(finalWidth));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, minWidth, maxWidth, persist],
  );

  // Double-click on the handle resets to the default width — common
  // affordance in split-pane UIs (VSCode, Slack, etc).
  const onDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  return (
    <div
      ref={paneRef}
      style={{ width: `${width}px` }}
      className={cn(
        // Inline width only applies on lg+; below that the parent stack
        // forces the pane to full width with Tailwind classes, so the
        // style is a no-op visually but doesn't fight the layout.
        "relative shrink-0",
        className,
      )}
    >
      {children}
      {/* Drag handle — sits 2px inside the right edge so it overlaps the
          border and is easy to grab without a visible scrollbar gutter. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Cambiar ancho del panel"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        className={cn(
          "group absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize lg:block",
          dragging && "bg-primary/20",
        )}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/40",
            dragging && "bg-primary",
          )}
        />
      </div>
    </div>
  );
}
