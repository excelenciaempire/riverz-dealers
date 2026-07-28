"use client";

import { useEffect, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/** Controles de filtro compartidos por las tablas del panel. */

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // Debounce: cada tecla dispararía una consulta cross-tenant.
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-56 rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
      />
    </div>
  );
}

export function Choice({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary/50",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Días hacia atrás. Devuelve el `from` ISO listo para la query. */
export function RangePicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: number) => void;
}) {
  const t = useT();
  return (
    <Choice
      value={String(days)}
      onChange={(v) => onChange(Number(v))}
      options={[
        { value: "7", label: t("admin.rangeLast7") },
        { value: "30", label: t("admin.rangeLast30") },
        { value: "90", label: t("admin.rangeLast90") },
      ]}
    />
  );
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <RefreshCw className="size-3.5" />
      {t("admin.refresh")}
    </button>
  );
}

/** `from` ISO para un rango de N días hacia atrás desde ahora. */
export function fromDays(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
