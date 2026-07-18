"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { createClient } from "@/lib/supabase/client";

/**
 * Blocking re-consent modal. The dashboard layout renders it ONLY when the
 * signed-in user's recorded Terms/Privacy version is older than the current
 * docs (needsReconsent). They must accept the updated documents before
 * continuing — accepting records a fresh, timestamped consent for the current
 * version via /api/legal/reconsent. There is no dismiss/close path by design.
 */
export function ReconsentGate() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const accept = async () => {
    setSubmitting(true);
    try {
      const res = await fetchWithCsrf("/api/legal/reconsent", { method: "POST" });
      if (res.ok) setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Rechazar = no se puede usar la app sin aceptar los términos: cerramos
  // sesión y volvemos al login. No se registra consentimiento.
  const reject = async () => {
    setSubmitting(true);
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.href = "/ingresar";
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">
          {t("legal.reconsentTitle")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("legal.reconsentBody")}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href="/terminos"
            target="_blank"
            className="text-primary underline underline-offset-2"
          >
            {t("legal.footerTerms")}
          </Link>
          <Link
            href="/privacidad"
            target="_blank"
            className="text-primary underline underline-offset-2"
          >
            {t("legal.footerPrivacy")}
          </Link>
        </div>
        <button
          onClick={accept}
          disabled={submitting}
          className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting ? t("legal.reconsentAccepting") : t("legal.reconsentAccept")}
        </button>
        <button
          onClick={reject}
          disabled={submitting}
          className="mt-2 w-full rounded-lg px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          {t("legal.reconsentReject")}
        </button>
      </div>
    </div>
  );
}
