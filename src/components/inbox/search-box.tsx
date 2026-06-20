"use client";

/**
 * Búsqueda full-text dentro de la Bandeja. Aparece arriba de
 * ChannelFilter. Cuando el usuario tipea 2+ caracteres, debouncea
 * 300ms y golpea /api/inbox/search. Los resultados se renderizan en
 * un dropdown debajo del input con el snippet del mensaje y el nombre
 * del contacto.
 *
 * Click en un resultado abre esa conversación (delegado vía onSelect).
 */

import { useEffect, useRef, useState } from "react";
import { Search, X, MessageSquare, Inbox as InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

interface SearchResult {
  id: string;
  contact_name: string;
  snippet: string;
  last_message_at: string | null;
  match_in: "preview" | "message";
  message_id?: string;
}

export function InboxSearchBox({
  onSelect,
}: {
  onSelect: (conversationId: string, messageId?: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/inbox/search?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { conversations: SearchResult[] };
        setResults(data.conversations ?? []);
        setActiveIdx(0);
      } catch {
        // silent — abort or network blip
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const showResults = open && query.trim().length >= 2;

  return (
    <div ref={wrapperRef} className="relative border-b border-border bg-card p-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showResults) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) =>
                results.length === 0 ? 0 : (i + 1) % results.length,
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) =>
                results.length === 0
                  ? 0
                  : (i - 1 + results.length) % results.length,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = results[activeIdx];
              if (r) {
                onSelect(r.id, r.message_id);
                setOpen(false);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={t("inbox.searchAll")}
          className="w-full rounded-md border border-border bg-muted/30 py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("inbox.clear")}
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {showResults && (
        <div className="absolute left-2 right-2 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-md border border-border bg-popover shadow-xl shadow-black/30">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("inbox.searching")}
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {t("inbox.noResultsDot")}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.id}-${r.message_id ?? "preview"}`}
              type="button"
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => {
                onSelect(r.id, r.message_id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                i === activeIdx ? "bg-accent" : "hover:bg-muted",
              )}
            >
              {r.match_in === "preview" ? (
                <InboxIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              ) : (
                <MessageSquare className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium text-foreground">
                    {r.contact_name}
                  </span>
                  {r.last_message_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(r.last_message_at).toLocaleDateString("es")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {r.snippet}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
