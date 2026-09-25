"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ShieldAlert, ExternalLink, Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import { mercadoLibreWebOrigin } from "@/lib/channels/mercadolibre/sites";

/**
 * Reclamos abiertos de Mercado Libre.
 *
 * No son conversaciones y por eso no caben en la lista de hilos: un reclamo es
 * un expediente con estado y reloj, no un intercambio de mensajes. Pero vive
 * en el mismo sitio que el resto de Mercado Libre porque es donde el vendedor
 * lo va a buscar, y porque un reclamo sin atender le pega directo a la
 * reputación — es lo más urgente de todo el canal.
 *
 * Sólo lectura: la gestión ocurre en Mercado Libre, y cada fila enlaza allá.
 */

interface ClaimRow {
  id: string;
  claim_id: string;
  connection_id: string | null;
  order_id: string | null;
  stage: string | null;
  status: string | null;
  type: string | null;
  reason: string | null;
  opened_at: string | null;
}

interface Claim extends ClaimRow {
  url: string;
}

export function MlClaimsPanel({
  workspaceId,
  compact = false,
}: {
  workspaceId: string | null;
  /** Encabezado de la lista: cuando el filtro es "Todas" los reclamos van
   *  arriba de las conversaciones, así que sin reclamos no se dibuja nada en
   *  vez de ocupar sitio con un estado vacío. */
  compact?: boolean;
}) {
  const t = useT();
  const format = useFormat();
  const [claims, setClaims] = useState<Claim[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // El caso "sin workspace" se resuelve DENTRO del async a propósito: un
      // setState síncrono dentro del efecto encadena renders (y lo prohíbe la
      // regla de hooks).
      if (!workspaceId) {
        if (!cancelled) setClaims([]);
        return;
      }
      const supabase = createClient();
      const [{ data }, { data: connections }] = await Promise.all([
        supabase
          .from("ml_claims")
          .select("id, claim_id, connection_id, order_id, stage, status, type, reason, opened_at")
          .eq("workspace_id", workspaceId)
          .neq("status", "closed")
          .order("opened_at", { ascending: false })
          .limit(100),
        // El reclamo se abre en el sitio del país de la cuenta.
        supabase
          .from("channel_connections")
          .select("id, config")
          .eq("workspace_id", workspaceId)
          .eq("channel", "mercadolibre"),
      ]);
      const siteOf = new Map(
        ((connections ?? []) as Array<{ id: string; config: Record<string, unknown> | null }>).map(
          (c) => [c.id, c.config?.site_id],
        ),
      );
      if (!cancelled)
        setClaims(
          ((data ?? []) as ClaimRow[]).map((c) => ({
            ...c,
            url: `${mercadoLibreWebOrigin(c.connection_id ? siteOf.get(c.connection_id) : null)}/reclamos/${c.claim_id}`,
          })),
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (claims === null) {
    if (compact) return null;
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (claims.length === 0) {
    if (compact) return null;
    // Cero reclamos es una BUENA noticia, no un vacío que arreglar. Se dice
    // así, en vez del "no hay nada por aquí" que usa una lista sin resultados.
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1.5 px-6 text-center">
        <ShieldAlert className="size-5 text-emerald-500/70" />
        <p className="text-sm font-medium text-foreground">
          {t("inbox.mlNoClaims")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("inbox.mlNoClaimsHint")}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {claims.map((c) => (
        <li key={c.id}>
          <a
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-accent/50"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {c.type || t("inbox.mlClaim")}
                </span>
                {c.stage && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      "bg-amber-400/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-400/30",
                    )}
                  >
                    {c.stage}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[
                  c.order_id ? `#${c.order_id}` : null,
                  c.reason,
                  c.opened_at ? format.date(c.opened_at) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          </a>
        </li>
      ))}
    </ul>
  );
}
