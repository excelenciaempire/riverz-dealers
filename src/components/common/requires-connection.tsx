"use client";

import Link from "next/link";
import { Plug2, Loader2 } from "lucide-react";
import { useActiveConnections } from "@/hooks/use-active-connections";

interface RequiresConnectionProps {
  /** Short title shown above the explanation. */
  title: string;
  /** One-sentence description of WHY this module needs a connection. */
  description: string;
  children: React.ReactNode;
}

/**
 * Wrap a page that only makes sense once at least one channel is
 * officially connected. While there are zero connected channels, we
 * render a friendly empty state that links straight to the channels
 * settings. As soon as the admin connects something, the wrapped
 * content takes over.
 */
export function RequiresConnection({ title, description, children }: RequiresConnectionProps) {
  const { hasAny, loading } = useActiveConnections();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-primary/10 p-8 text-center">
          <div className="absolute -top-12 -right-12 size-48 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/15">
              <Plug2 className="size-7 text-accent-ink" />
            </div>
            <h2 className="text-lg font-bold text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <Link
              href="/integraciones"
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plug2 className="size-4" />
              Conectar un canal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
