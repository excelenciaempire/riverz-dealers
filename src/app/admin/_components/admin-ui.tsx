"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/**
 * Piezas compartidas del panel de plataforma.
 *
 * Once pantallas hacen lo mismo: pedir JSON a `/api/admin/*`, mostrar un
 * cargando, una tabla y un vacío. Esto lo resuelve una vez para que cada
 * pantalla sea solo sus columnas.
 */

// ────────────────────────────────────────────────────────────────
// Carga de datos
// ────────────────────────────────────────────────────────────────

interface Fetched<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
  /** Se está refrescando solo (no es la primera carga). */
  live: boolean;
}

/** Cada cuánto se refresca sola una pantalla del panel. */
export const LIVE_MS = 30_000;

/**
 * GET a una ruta de admin, con refresco automático, recarga manual y
 * cancelación al desmontar.
 *
 * **Por qué polling y no Supabase realtime**: realtime va con la RLS de la
 * sesión, así que un admin sólo recibiría eventos de su propio workspace — que
 * es justo lo que este panel no mira. Los datos de plataforma salen de rutas que
 * corren con la clave de servicio, y la forma de mantenerlas frescas es
 * preguntarlas.
 *
 * **Pausado cuando la pestaña no se ve.** Una pestaña olvidada en segundo plano
 * seguiría preguntando toda la tarde, y algunas de estas rutas cuestan dinero de
 * verdad (`/api/admin/infrastructure` sondea completions facturables). Al volver
 * a la pestaña se refresca una vez, así que lo que se ve nunca es viejo.
 */
export function useAdminData<T>(url: string, intervalMs = LIVE_MS): Fetched<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [live, setLive] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Descarta respuestas de una petición vieja que llegue tarde tras cambiar
  // un filtro — si no, la tabla parpadea con datos que ya nadie pidió.
  const latest = useRef(0);

  useEffect(() => {
    let cancelled = false;

    /** `silent` = refresco de fondo: no vuelve a poner la pantalla en "cargando". */
    const load = async (silent: boolean) => {
      const ticket = ++latest.current;
      if (!silent) {
        setLoading(true);
        setError(false);
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as T;
        if (ticket === latest.current && !cancelled) {
          setData(json);
          setError(false);
        }
      } catch {
        // Un fallo del refresco de fondo no borra lo que ya se está viendo:
        // dejar la pantalla en rojo por un corte de red de un segundo es peor
        // que mostrar datos de hace treinta.
        if (ticket === latest.current && !cancelled && !silent) setError(true);
      } finally {
        if (ticket === latest.current && !cancelled && !silent) setLoading(false);
      }
    };

    void load(false);

    if (!intervalMs) return () => {
      cancelled = true;
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void load(true), intervalMs);
      setLive(true);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      setLive(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Al volver, una lectura inmediata: si no, se ven hasta 30 s de pasado.
        void load(true);
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, nonce, intervalMs]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload, live };
}

// ────────────────────────────────────────────────────────────────
// Estructura de página
// ────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
  live,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Muestra el punto de "se está refrescando solo". */
  live?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {live && <LiveDot />}
        {actions}
      </div>
    </div>
  );
}

/** Punto que dice, sin texto, que lo que se ve se actualiza solo. */
export function LiveDot() {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={t("admin.liveHint")}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      {t("admin.live")}
    </span>
  );
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card", className)}
    >
      {title && (
        <h2 className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Loading() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      <span>{t("admin.loadError")}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {t("admin.refresh")}
        </button>
      )}
    </div>
  );
}

export function Empty() {
  const t = useT();
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
      {t("admin.empty")}
    </p>
  );
}

// ────────────────────────────────────────────────────────────────
// Tabla
// ────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  /** Alinea a la derecha — para números. */
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  footer?: React.ReactNode;
}) {
  if (!rows.length) return <Empty />;
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted-foreground",
                  c.numeric ? "text-right" : "text-left",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && "cursor-pointer transition-colors hover:bg-muted/50",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-4 py-2.5 align-top",
                    c.numeric && "text-right tabular-nums",
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Indicadores
// ────────────────────────────────────────────────────────────────

export type Tone = "ok" | "warn" | "error" | "muted";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
  muted: "bg-muted-foreground/40",
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      <span className={TONE_TEXT[tone]}>{label}</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone ? TONE_TEXT[tone] : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Texto secundario que no debe romper la fila. */
export function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs text-muted-foreground">{children}</span>
  );
}

/** Trunca un texto largo (errores, ids) sin ensanchar la tabla. */
export function Clamp({ text }: { text: string | null | undefined }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="block max-w-[36ch] truncate" title={text}>
      {text}
    </span>
  );
}
