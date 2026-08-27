"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";

/**
 * Vistas de la bandeja.
 *
 * La lista tenía filtro por canal y poco más: no había forma de ver "las que
 * nadie tomó" ni "las mías", que es la primera pregunta de cualquiera que
 * comparte una bandeja con otra persona. Y las vistas guardadas existían desde
 * la migración 029 —tabla, endpoint y todo— sin una sola pantalla que las
 * usara: se podían crear por API y no se podían ver.
 *
 * Las cuatro de arriba son fijas porque son las mismas en todos lados; las
 * guardadas son la combinación que ESTE comercio repite todos los días.
 */

export type VistaBandeja = "all" | "unassigned" | "mine" | "unread";

interface VistaGuardada {
  id: string;
  name: string;
  config: { vista?: VistaBandeja; channel?: string | null };
}

const FIJAS: { valor: VistaBandeja; clave: string }[] = [
  { valor: "all", clave: "inbox.viewAll" },
  { valor: "unassigned", clave: "inbox.viewUnassigned" },
  { valor: "mine", clave: "inbox.viewMine" },
  { valor: "unread", clave: "inbox.viewUnread" },
];

export function InboxViews({
  vista,
  onVista,
  canal,
  onCanal,
}: {
  vista: VistaBandeja;
  onVista: (v: VistaBandeja) => void;
  /** El canal activo, para poder guardarlo dentro de una vista. */
  canal: string | null;
  onCanal: (c: string | null) => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [guardadas, setGuardadas] = useState<VistaGuardada[]>([]);
  const [nombrando, setNombrando] = useState(false);
  const [nombre, setNombre] = useState("");

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/filters", { cache: "no-store" });
      const json = await res.json();
      // Una bandeja sin vistas guardadas funciona igual: si falla, se muestran
      // las cuatro fijas y nadie ve un error por algo que no pidió.
      setGuardadas(res.ok ? ((json.filters ?? []) as VistaGuardada[]) : []);
    } catch {
      setGuardadas([]);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch("/api/inbox/filters", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo) setGuardadas((j?.filters ?? []) as VistaGuardada[]);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const guardar = async () => {
    const name = nombre.trim();
    if (!name) return;
    setNombre("");
    setNombrando(false);
    const res = await fetchWithCsrf("/api/inbox/filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config: { vista, channel: canal } }),
    }).catch(() => null);
    if (res?.ok) await cargar();
  };

  const borrar = async (id: string) => {
    const res = await fetchWithCsrf(`/api/inbox/filters?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res?.ok) await cargar();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      {FIJAS.map((f) => (
        <button
          key={f.valor}
          type="button"
          onClick={() => onVista(f.valor)}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs transition-colors",
            vista === f.valor
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t(f.clave)}
        </button>
      ))}

      {guardadas.map((g) => (
        <span
          key={g.id}
          className="group inline-flex items-center rounded-full border border-border text-xs text-muted-foreground"
        >
          <button
            type="button"
            onClick={() => {
              onVista(g.config?.vista ?? "all");
              onCanal(g.config?.channel ?? null);
            }}
            className="max-w-[140px] truncate py-1 pl-2.5 pr-1 transition-colors hover:text-foreground"
          >
            {g.name}
          </button>
          <button
            type="button"
            aria-label={g.name}
            onClick={() => void borrar(g.id)}
            className="py-1 pr-2 pl-0.5 opacity-0 transition group-hover:opacity-100 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {nombrando ? (
        <form
          className="inline-flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <input
            autoFocus
            value={nombre}
            maxLength={40}
            placeholder={t("inbox.viewNamePlaceholder")}
            onChange={(e) => setNombre(e.target.value)}
            onBlur={() => {
              if (!nombre.trim()) setNombrando(false);
            }}
            className="w-32 rounded-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:border-foreground/40"
          />
        </form>
      ) : (
        <button
          type="button"
          aria-label={t("inbox.viewSave")}
          title={t("inbox.viewSave")}
          onClick={() => setNombrando(true)}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
