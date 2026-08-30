"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { Button } from "@/components/ui/button";
import {
  formatSignupCode,
  signupCodeStatus,
  type SignupCodeRow,
  type SignupCodeStatus,
} from "@/lib/auth/signup-codes";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  Muted,
  Stat,
  StatusPill,
  type Column,
  type Tone,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

interface Row extends SignupCodeRow {
  redemptions: { email: string; redeemed_at: string }[];
}

const TONO: Record<SignupCodeStatus, Tone> = {
  active: "ok",
  used_up: "muted",
  expired: "warn",
  revoked: "error",
};

/**
 * Códigos de invitación: la puerta del alta.
 *
 * Sin refresco automático — es configuración, y una recarga a mitad de camino
 * haría saltar la tabla justo cuando alguien está copiando un código.
 */
export function Codigos() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const { data, loading, error, reload } = useAdminData<{
    rows: Row[];
    total: number;
  }>("/api/admin/signup-codes", 0);

  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // El portapapeles pide que la pestaña esté enfocada; sin eso la promesa
  // puede quedar colgada para siempre. Nunca se espera: copiar es una cortesía
  // y no puede dejar un botón en "Emitiendo…" de por vida.
  const copiar = useCallback((code: string) => {
    navigator.clipboard?.writeText(formatSignupCode(code)).then(
      () => {
        setCopied(code);
        setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
      },
      () => {},
    );
  }, []);

  const crear = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setCreating(true);
      try {
        const res = await fetchWithCsrf("/api/admin/signup-codes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quantity: Number(quantity) || 1,
            maxUses: Number(maxUses) || 1,
            expiresInDays: Number(expiresInDays) || 0,
            note,
          }),
        });
        if (!res.ok) throw new Error("failed");
        const payload = (await res.json()) as { codes: string[] };
        // Un código solo se copia al portapapeles apenas nace: es lo que se
        // hace con él y ahorra el viaje a la tabla.
        if (payload.codes.length === 1) copiar(payload.codes[0]);
        toast.success(t("admin.codesCreated", { n: String(payload.codes.length) }));
        setNote("");
        reload();
      } catch {
        toast.error(t("admin.codesCreateError"));
      } finally {
        setCreating(false);
      }
    },
    [fetchWithCsrf, quantity, maxUses, expiresInDays, note, copiar, reload, t],
  );

  const revocar = useCallback(
    async (row: Row) => {
      const revoked = !row.revoked_at;
      try {
        const res = await fetchWithCsrf("/api/admin/signup-codes", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: row.id, revoked }),
        });
        if (!res.ok) throw new Error("failed");
        reload();
      } catch {
        toast.error(t("admin.codesCreateError"));
      }
    },
    [fetchWithCsrf, reload, t],
  );

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "code",
        header: t("admin.colCode"),
        cell: (r) => (
          <button
            onClick={() => copiar(r.code)}
            className="inline-flex items-center gap-2 font-mono tracking-[0.12em] text-foreground hover:text-accent-ink"
            title={t("admin.copyCode")}
          >
            {formatSignupCode(r.code)}
            {copied === r.code ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5 text-muted-foreground" />
            )}
          </button>
        ),
      },
      {
        key: "status",
        header: t("admin.colStatus"),
        cell: (r) => {
          const s = signupCodeStatus(r);
          return <StatusPill tone={TONO[s]} label={t(`admin.codeStatus_${s}`)} />;
        },
      },
      {
        key: "uses",
        header: t("admin.colUses"),
        numeric: true,
        cell: (r) => (
          <span className="tabular-nums">
            {r.uses}/{r.max_uses}
          </span>
        ),
      },
      {
        key: "who",
        header: t("admin.colRedeemedBy"),
        cell: (r) =>
          r.redemptions.length ? (
            <div className="space-y-0.5">
              {r.redemptions.slice(0, 3).map((x) => (
                <p key={x.email + x.redeemed_at} className="text-foreground">
                  {x.email}
                </p>
              ))}
              {r.redemptions.length > 3 && (
                <Muted>+{r.redemptions.length - 3}</Muted>
              )}
            </div>
          ) : (
            <Muted>—</Muted>
          ),
      },
      {
        key: "note",
        header: t("admin.colNote"),
        cell: (r) => r.note ?? <Muted>—</Muted>,
      },
      {
        key: "expires",
        header: t("admin.colExpires"),
        cell: (r) =>
          r.expires_at ? format.dateTime(r.expires_at) : <Muted>—</Muted>,
      },
      {
        key: "created",
        header: t("admin.colCreated"),
        cell: (r) => (
          <div>
            <p className="text-foreground">{format.dateTime(r.created_at)}</p>
            {r.created_by_email && <Muted>{r.created_by_email}</Muted>}
          </div>
        ),
      },
      {
        key: "actions",
        header: "",
        cell: (r) => (
          <button
            onClick={() => revocar(r)}
            className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            {r.revoked_at ? t("admin.codeReactivate") : t("admin.codeRevoke")}
          </button>
        ),
      },
    ],
    [t, format, copiar, copied, revocar],
  );

  const activos =
    data?.rows.filter((r) => signupCodeStatus(r) === "active").length ?? 0;
  const usados = data?.rows.reduce((n, r) => n + r.uses, 0) ?? 0;

  const campo =
    "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50";

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.codesTitle")}
        description={t("admin.sectionCodesDesc")}
        actions={<RefreshButton onClick={reload} />}
      />

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t("admin.codesActive")} value={format.number(activos)} tone="ok" />
          <Stat label={t("admin.codesRedeemed")} value={format.number(usados)} />
          <Stat label={t("admin.totals")} value={format.number(data.total)} />
        </div>
      )}

      <Panel title={t("admin.codesNewTitle")}>
        <form onSubmit={crear} className="grid gap-3 p-4 sm:grid-cols-5">
          <label className="sm:col-span-2 flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("admin.colNote")}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("admin.codesNotePlaceholder")}
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("admin.codesMaxUses")}</span>
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("admin.codesExpiresDays")}</span>
            <input
              type="number"
              min={0}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder={t("admin.codesNoExpiry")}
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("admin.codesQuantity")}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={campo}
            />
          </label>
          <div className="sm:col-span-5">
            <Button type="submit" disabled={creating} className="h-9">
              {creating ? t("admin.codesCreating") : t("admin.codesCreate")}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel>
        {loading ? (
          <Loading forma="filas" />
        ) : error ? (
          <LoadError onRetry={reload} />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            rowKey={(r) => r.id}
          />
        )}
      </Panel>
    </div>
  );
}
