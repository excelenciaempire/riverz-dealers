"use client";

import { ChevronRight } from "lucide-react";
import Link from "@/components/i18n/locale-link";
import { useT } from "@/hooks/use-locale";
import { ADMIN_SECTIONS } from "./sections";

/** Home del panel de plataforma: índice de secciones globales. */
export default function AdminHomePage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("admin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("admin.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ADMIN_SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t(s.label)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(s.description)}</p>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
