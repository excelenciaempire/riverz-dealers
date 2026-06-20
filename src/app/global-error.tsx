"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/log/logger";
import { useT } from "@/hooks/use-locale";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    captureException(error, { scope: "app.global-error", digest: error.digest });
  }, [error]);

  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <span className="mb-6 inline-block text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink">
              riverz
            </span>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground">
              {t("system.globalErrorTitle")}
            </h1>
            <p className="mb-8 text-sm text-muted-foreground">
              {t("system.globalErrorDescription")}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => reset()}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("system.retry")}
              </button>
              <a
                href="/panel"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {t("system.backHome")}
              </a>
            </div>
            {error.digest ? (
              <p className="mt-6 font-mono text-xs text-muted-foreground">
                {t("system.refPrefix")} {error.digest}
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
