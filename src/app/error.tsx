"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { captureException } from "@/lib/log/logger";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { scope: "app.route-error", digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <span className="mb-6 inline-block text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
          riverz
        </span>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground">
          Algo salió mal
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Tuvimos un problema cargando esta vista. Puedes intentar de nuevo o
          volver al panel.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={() => reset()}>Reintentar</Button>
          <Link
            href="/panel"
            className={buttonVariants({ variant: "outline" })}
          >
            Volver al inicio
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            ref {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
