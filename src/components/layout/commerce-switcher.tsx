"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2, Search, Store } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/hooks/use-locale";
import { useCsrfToken } from "@/components/auth/csrf-provider";
import { localizePath } from "@/lib/i18n/routes";
import { COMMERCE_CHANGE_KEY } from "@/lib/auth/commerce-cookies";

type Commerce = { id: string; name: string; email: string | null };
type Snapshot = { rows: Commerce[]; activeWorkspaceId: string | null; actingWorkspaceId: string | null; canReturn: boolean };

export function CommerceSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const csrf = useCsrfToken();
  const [data, setData] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setQuery("");
    void fetch("/api/admin/commerce-session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || t("nav.commerceLoadFailed"));
        setData(result);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t("nav.commerceLoadFailed"));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, t]);

  async function change(id: string | null) {
    if (!csrf || busy) return;
    setBusy(id ?? "return");
    setError(null);
    try {
      const response = await fetch("/api/admin/commerce-session", {
        method: id ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        ...(id ? { body: JSON.stringify({ workspaceId: id }) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("nav.commerceSwitchFailed"));
      try { localStorage.setItem(COMMERCE_CHANGE_KEY, String(Date.now())); } catch { /* Storage may be disabled. */ }
      // A new document clears query caches and realtime subscriptions for the old store.
      window.location.assign(localizePath("/panel", locale));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("nav.commerceSwitchFailed"));
      setBusy(null);
    }
  }

  const needle = query.trim().toLocaleLowerCase();
  const rows = data?.rows.filter((row) => `${row.name} ${row.email ?? ""}`.toLocaleLowerCase().includes(needle)) ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t("nav.switchCommerce")}</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("nav.commerceSearch")} aria-label={t("nav.commerceSearch")} className="pl-9" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="max-h-[48dvh] space-y-1 overflow-y-auto">
          {loading ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin" aria-label={t("nav.commerceLoading")} /></div> : rows.map((row) => (
            <button key={row.id} type="button" onClick={() => void change(row.id)} disabled={Boolean(busy) || !csrf}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60">
              <Store className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.name}</span><span className="block truncate text-xs text-muted-foreground">{row.email}</span></span>
              {busy === row.id ? <Loader2 className="size-4 animate-spin" /> : data?.activeWorkspaceId === row.id ? <Check className="size-4 text-primary" aria-label={t("nav.commerceCurrent")} /> : null}
            </button>
          ))}
          {!loading && !error && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("nav.commerceEmpty")}</p>}
        </div>
        {data?.actingWorkspaceId && data.canReturn && <Button variant="outline" disabled={Boolean(busy) || !csrf} onClick={() => void change(null)}><ArrowLeft className="size-4" />{t("nav.commerceReturn")}</Button>}
      </DialogContent>
    </Dialog>
  );
}
