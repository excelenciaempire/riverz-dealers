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
}

/** GET a una ruta de admin, con recarga manual y cancelación al desmontar. */
export function useAdminData<T>(url: string): Fetched<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Descarta respuestas de una petición vieja que llegue tarde tras cambiar
  // un filtro — si no, la tabla parpadea con datos que ya nadie pidió.
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as T;
        if (ticket === latest.current) setData(json);
      } catch {
        if (ticket === latest.current) setError(true);
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    })();
  }, [url, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

// ────────────────────────────────────────────────────────────────
// Estructura de página
// ────────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
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
