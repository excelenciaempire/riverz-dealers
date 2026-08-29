"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
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
  /**
   * Para las pantallas que escriben: mover la UI antes de que conteste el
   * servidor y revertir si falla. Sin esto, un interruptor tarda medio segundo
   * en moverse y parece que no se apretó.
   */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/** Cada cuánto se refresca sola una pantalla del panel. */
export const LIVE_MS = 30_000;

/**
 * Lo último que contestó cada ruta, para pintar antes de preguntar.
 *
 * El panel es todo cliente: cada pantalla montaba, mandaba su GET y mostraba un
 * spinner hasta que volvía. Con `/api/admin/overview` cruzando los avisos de
 * todos los comercios eso son varios segundos de pantalla vacía **cada vez que
 * se entra**, aunque hayas estado ahí hace diez segundos.
 *
 * Guardar la última respuesta por URL vuelve inmediato el segundo ingreso: se
 * pinta lo de antes con el punto de "se está actualizando" y la respuesta nueva
 * lo reemplaza cuando llega. `sessionStorage` y no `localStorage` a propósito —
 * son datos de plataforma de todas las cuentas, y no tienen por qué sobrevivir
 * a que se cierre la pestaña.
 */
const CACHE_PREFIJO = "riverz.admin.cache:";

function leerCache<T>(url: string): T | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIJO + url);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Modo privado, cuota llena o un JSON viejo con otra forma: se pide igual.
    return null;
  }
}

function guardarCache(url: string, valor: unknown): void {
  try {
    sessionStorage.setItem(CACHE_PREFIJO + url, JSON.stringify(valor));
  } catch {
    // Sin caché se sigue funcionando: sólo se pierde el pintado inmediato.
  }
}

/**
 * Vaciar lo guardado al cerrar el panel.
 *
 * Cerrarlo vuelve a pedir la contraseña, y sería raro que después de eso
 * quedaran los datos de todos los comercios en la pestaña esperando a que
 * alguien abra las herramientas del navegador.
 */
export function limpiarCacheAdmin(): void {
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(CACHE_PREFIJO)) sessionStorage.removeItem(k);
    }
  } catch {
    // Nada que limpiar si no hay storage.
  }
}

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
      // Con algo ya en pantalla, esta carga se comporta como un refresco de
      // fondo aunque no lo sea: no muestra "cargando" y un fallo no borra lo
      // que se está viendo.
      let mudo = silent;
      if (!silent) {
        // La caché se lee acá dentro —en el efecto— y no en el `useState`: en
        // el servidor no existe `sessionStorage`, así que sembrarla arriba
        // haría que el HTML del servidor y el del cliente no coincidan.
        const previo = leerCache<T>(url);
        if (previo !== null) {
          setData(previo);
          setError(false);
          setLoading(false);
          mudo = true;
        } else {
          setLoading(true);
          setError(false);
        }
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as T;
        if (ticket === latest.current && !cancelled) {
          setData(json);
          setError(false);
          guardarCache(url, json);
        }
      } catch {
        // Un fallo del refresco de fondo no borra lo que ya se está viendo:
        // dejar la pantalla en rojo por un corte de red de un segundo es peor
        // que mostrar datos de hace treinta.
        if (ticket === latest.current && !cancelled && !mudo) setError(true);
      } finally {
        if (ticket === latest.current && !cancelled && !mudo) setLoading(false);
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
  return { data, loading, error, reload, live, setData };
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

/**
 * Lo que se ve mientras llega el JSON.
 *
 * Un spinner centrado sobre fondo vacío no dice nada y hace sentir la espera
 * más larga de lo que es. Un esqueleto con la geometría de lo que viene deja la
 * página quieta: cuando llegan los datos no salta nada de lugar.
 *
 * `forma` describe la pantalla que está cargando; el defecto es la mezcla más
 * común del panel (unas cajas de números y una tabla).
 */
export function Loading({
  forma = "stats+table",
  filas = 6,
  cajas = 4,
}: {
  /**
   * `filas` es el esqueleto SIN caja, para cuando ya se está dentro de un
   * `Panel` — si no, quedan dos bordes redondeados uno adentro del otro.
   */
  forma?: "stats" | "table" | "filas" | "panel" | "stats+table";
  /** Filas del esqueleto de tabla. */
  filas?: number;
  /** Cajas del esqueleto de números. */
  cajas?: number;
}) {
  if (forma === "filas") {
    return (
      <div className="divide-y divide-border" aria-busy="true" aria-live="polite">
        {Array.from({ length: filas }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Hueso className="h-3.5 flex-1" />
            <Hueso className="hidden h-3.5 w-24 sm:block" />
            <Hueso className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {(forma === "stats" || forma === "stats+table") && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: cajas }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4">
              <Hueso className="h-3 w-20" />
              <Hueso className="mt-2 h-7 w-16" />
            </div>
          ))}
        </div>
      )}
      {(forma === "table" || forma === "panel" || forma === "stats+table") && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <Hueso className="h-4 w-40" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: forma === "panel" ? 3 : filas }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Hueso className="h-3.5 flex-1" />
                <Hueso className="hidden h-3.5 w-24 sm:block" />
                <Hueso className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Un bloque gris que late. Respeta "reducir movimiento" por el propio Tailwind. */
function Hueso({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse rounded bg-muted-foreground/15", className)}
    />
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
