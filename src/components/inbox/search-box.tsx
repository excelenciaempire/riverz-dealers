"use client";

/**
 * Búsqueda full-text dentro de la Bandeja. Vive arriba de la lista y filtra
 * ESA MISMA lista: se escribe y abajo quedan sólo las conversaciones que
 * coinciden, en orden de relevancia.
 *
 * Antes los resultados aparecían en un panel flotante sobre la lista: dos
 * listas distintas, una tapando a la otra, y las filas del panel no eran las
 * de la bandeja —sin canal, sin no-leídos, sin acciones—. Buscar y ver son la
 * misma cosa, así que ahora hay una sola lista.
 *
 * La búsqueda sigue siendo del servidor (`/api/inbox/search`, con `unaccent`),
 * que es lo que permite encontrar una palabra dicha ADENTRO de una
 * conversación y no sólo en la vista previa. Lo que viaja hacia arriba son los
 * ids en orden; la lista de abajo hace el resto.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/hooks/use-locale";

export interface InboxSearchState {
  /** Hay una búsqueda en curso (2+ caracteres). */
  active: boolean;
  loading: boolean;
  /** Ids de conversación, ya ordenados por relevancia. */
  ids: string[];
}

interface SearchResult {
  id: string;
}

export function InboxSearchBox({
  onResults,
}: {
  onResults: (state: InboxSearchState) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  // Ref para que el efecto de búsqueda no dependa de la identidad del callback.
  const onResultsRef = useRef(onResults);
  useEffect(() => {
    onResultsRef.current = onResults;
  }, [onResults]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      onResultsRef.current({ active: false, loading: false, ids: [] });
      return;
    }
    onResultsRef.current({ active: true, loading: true, ids: [] });
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inbox/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          onResultsRef.current({ active: true, loading: false, ids: [] });
          return;
        }
        const data = (await res.json()) as { conversations: SearchResult[] };
        // Una conversación puede venir varias veces (coincide la vista previa
        // y además un mensaje viejo): la lista de abajo la muestra una sola.
        const ids = [...new Set((data.conversations ?? []).map((r) => r.id))];
        onResultsRef.current({ active: true, loading: false, ids });
      } catch {
        // silencio — abort o corte de red
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  return (
    <div className="border-b border-border bg-card p-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          data-inbox-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder={t("inbox.searchAll")}
          className="w-full rounded-md border border-border bg-muted/30 py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("inbox.clear")}
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
