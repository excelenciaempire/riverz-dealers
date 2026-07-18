"use client";

/**
 * Dialog que lista las versiones del flujo (draft + published) y deja
 * restaurar cualquiera con un click. Antes de restaurar se hace un
 * snapshot draft del estado actual como respaldo, así el merchant
 * puede deshacer la restauración si se arrepiente.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  History,
  CircleCheck,
  FileText,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";

interface FlowVersion {
  id: string;
  kind: "draft" | "published" | "autosave";
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export function FlowVersionsDialog({
  flowId,
  open,
  onClose,
  onRestored,
}: {
  flowId: string;
  open: boolean;
  onClose: () => void;
  /** Recargar el editor con el snapshot restaurado. */
  onRestored: () => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/versions`);
      if (!res.ok) throw new Error(t("flows.versionsLoadFailed"));
      const data = (await res.json()) as { versions: FlowVersion[] };
      setVersions(data.versions ?? []);
    } catch (err) {
      toast.error(t("flows.genericError"));
    } finally {
      setLoading(false);
    }
  }, [flowId, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function handleRestore(version: FlowVersion) {
    setRestoringId(version.id);
    try {
      const res = await fetchWithCsrf(
        `/api/flows/${flowId}/versions/${version.id}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? t("flows.restoreFailed"));
      }
      toast.success(t("flows.versionRestored"));
      onRestored();
      onClose();
    } catch (err) {
      toast.error(t("flows.genericError"));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            {t("flows.flowVersions")}
          </DialogTitle>
          <DialogDescription>
            {t("flows.versionsDescription")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t("flows.noVersionsYet")}
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  {v.kind === "published" ? (
                    <CircleCheck className="mt-0.5 size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <FileText className="mt-0.5 size-4 text-muted-foreground" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          v.kind === "published"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {v.kind === "published" ? t("flows.versionPublished") : t("flows.versionDraft")}
                      </span>
                      <span className="text-xs text-foreground">
                        {new Date(v.created_at).toLocaleString("es", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    {v.note && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {v.note}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restoringId !== null}
                  onClick={() => void handleRestore(v)}
                >
                  {restoringId === v.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  {t("flows.restore")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("flows.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
