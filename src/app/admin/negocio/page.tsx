"use client";

import { useMemo, useState } from "react";
import { useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import type { Plan } from "@/lib/billing/plan";
import type { CuentaDelNegocio, Negocio } from "@/lib/billing/negocio";
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  DataTable,
  StatusPill,
  Muted,
  Stat,
  type Column,
  type Tone,
} from "../_components/admin-ui";
import { RangePicker, RefreshButton, fromDays } from "../_components/filters";

/**
 * El negocio: cuánto entra, cuánto sale y qué paga cada comercio.
 *
 * Hasta acá no había forma de contestar «¿cuánto factura Riverz?». Se podía
 * operar la cuenta de un comercio de punta a punta y no había dónde anotar que
 * ese comercio paga.
 *
 * Las cuentas de **cortesía** —los primeros comercios, a los que se les instala
 * gratis— cuentan como clientes con MRR 0 y no se excluyen. En esta etapa son
 * la mayoría, y sacarlas del cuadro haría parecer que no hay nadie usando la
 * plataforma cuando el costo de atenderlas es real y es justo lo que hay que
 * mirar.
 *
 * El precio se edita acá y no en el código: en una etapa donde todavía se está
 * descubriendo, tenerlo compilado significa que cada prueba cuesta un deploy.
 */

interface Payload {
  planes: Plan[];
  negocio: Negocio;
  diasDePrueba: number;
}

const ESTADOS = ["prueba", "activa", "cortesia", "vencida", "cancelada"] as const;

const TONO: Record<string, Tone> = {
  activa: "ok",
  cortesia: "muted",
  prueba: "warn",
  vencida: "error",
  cancelada: "error",
};

const usd = (centavos: number) =>
  `US$${(centavos / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function AdminNegocioPage() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [dias, setDias] = useState(30);
  const [editando, setEditando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const url = `/api/admin/billing?from=${fromDays(dias)}`;
  const { data, loading, error, reload, live } = useAdminData<Payload>(url);

  const guardarCuenta = async (cuenta: Record<string, unknown>) => {
    setGuardando(true);
    try {
      await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta }),
      });
      setEditando(null);
      reload();
    } finally {
      setGuardando(false);
    }
  };

  const guardarPlan = async (plan: Record<string, unknown>) => {
    setGuardando(true);
    try {
      await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      reload();
    } finally {
      setGuardando(false);
    }
  };

  const columns = useMemo<Column<CuentaDelNegocio>[]>(
    () => [
      {
        key: "nombre",
        header: t("admin.workspace"),
        cell: (c) => (
          <div>
            <p className="font-medium text-foreground">{c.nombre}</p>
            {c.nota && <Muted>{c.nota}</Muted>}
          </div>
        ),
      },
      {
        key: "estado",
        header: t("admin.billingState"),
        cell: (c) => (
          <StatusPill
            tone={TONO[c.estado] ?? "muted"}
            label={t(`admin.billingState_${c.estado}`)}
          />
        ),
      },
      {
        key: "mrr",
        header: t("admin.billingMrr"),
        cell: (c) => (
          <span className="tabular-nums">
            {usd(c.mrrCentavos)}
            {c.tratoPropio && <Muted> · {t("admin.billingOwnDeal")}</Muted>}
          </span>
        ),
      },
      {
        key: "uso",
        header: t("admin.billingUsage"),
        cell: (c) => (
          <span className="tabular-nums">
            {c.conversaciones.toLocaleString()}
            <Muted> · US${c.costoUsd.toFixed(2)}</Muted>
          </span>
        ),
      },
      {
        key: "acciones",
        header: "",
        cell: (c) => (
          <button
            type="button"
            onClick={() => setEditando(editando === c.workspaceId ? null : c.workspaceId)}
            className="text-xs text-accent-ink hover:underline"
          >
            {t("admin.billingEdit")}
          </button>
        ),
      },
    ],
    [editando, t],
  );

  if (loading && !data) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const { negocio, planes } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.sectionBusiness")}
        description={t("admin.sectionBusinessDesc")}
        live={live}
        actions={
          <>
            <RangePicker days={dias} onChange={setDias} />
            <RefreshButton onClick={reload} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("admin.billingMrr")} value={usd(negocio.mrrCentavos)} tone="ok" />
        <Stat label={t("admin.billingArr")} value={usd(negocio.arrCentavos)} />
        <Stat
          label={t("admin.billingCost")}
          value={`US$${negocio.costoUsd.toFixed(2)}`}
          hint={
            negocio.margenPct === null
              ? t("admin.billingNoMargin")
              : t("admin.billingMargin", { n: negocio.margenPct })
          }
        />
        <Stat
          label={t("admin.billingArpu")}
          value={usd(negocio.arpuCentavos)}
          hint={t("admin.billingPaying", { n: negocio.clientes.pagando })}
        />
      </div>

      <Panel title={t("admin.billingCustomers")}>
        <div className="flex flex-wrap gap-4 p-4 text-sm">
          {ESTADOS.map((e) => {
            const n =
              e === "activa"
                ? negocio.clientes.pagando
                : e === "cortesia"
                  ? negocio.clientes.cortesia
                  : e === "prueba"
                    ? negocio.clientes.enPrueba
                    : e === "vencida"
                      ? negocio.clientes.vencidas
                      : negocio.clientes.canceladas;
            return (
              <span key={e} className="tabular-nums">
                <strong className="text-foreground">{n}</strong>{" "}
                <Muted>{t(`admin.billingState_${e}`)}</Muted>
              </span>
            );
          })}
        </div>
      </Panel>

      <Panel title={t("admin.billingPlans")}>
        <div className="space-y-3 p-4">
          {planes.map((p) => (
            <FilaPlan key={p.slug} plan={p} onGuardar={guardarPlan} guardando={guardando} />
          ))}
          <FilaPlan onGuardar={guardarPlan} guardando={guardando} />
        </div>
      </Panel>

      <Panel title={t("admin.billingAccounts")}>
        <DataTable rows={negocio.cuentas} columns={columns} rowKey={(c) => c.workspaceId} />
        {editando && (
          <div className="border-t border-border p-4">
            <FormularioCuenta
              cuenta={negocio.cuentas.find((c) => c.workspaceId === editando)!}
              planes={planes}
              guardando={guardando}
              onGuardar={guardarCuenta}
              onCerrar={() => setEditando(null)}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent-ink";

/** Un plan, editable en su fila. Sin plan = el formulario para crear uno. */
function FilaPlan({
  plan,
  onGuardar,
  guardando,
}: {
  plan?: Plan;
  onGuardar: (p: Record<string, unknown>) => void;
  guardando: boolean;
}) {
  const t = useT();
  const [f, setF] = useState({
    slug: plan?.slug ?? "",
    nombre: plan?.nombre ?? "",
    precio: String((plan?.precioCentavos ?? 0) / 100),
    incluidas: String(plan?.incluidas ?? 0),
    excedente: String((plan?.excedenteCentavos ?? 0) / 100),
    stripe: plan?.stripePriceId ?? "",
    stripeExc: plan?.stripePriceExcedenteId ?? "",
  });

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-xl border border-border p-3 lg:grid-cols-7">
      <Campo label={t("admin.billingSlug")}>
        <input
          className={INPUT}
          value={f.slug}
          disabled={Boolean(plan)}
          onChange={(e) => setF({ ...f, slug: e.target.value })}
        />
      </Campo>
      <Campo label={t("admin.billingName")}>
        <input
          className={INPUT}
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
        />
      </Campo>
      <Campo label={t("admin.billingPrice")}>
        <input
          className={INPUT}
          inputMode="decimal"
          value={f.precio}
          onChange={(e) => setF({ ...f, precio: e.target.value })}
        />
      </Campo>
      <Campo label={t("admin.billingIncluded")}>
        <input
          className={INPUT}
          inputMode="numeric"
          value={f.incluidas}
          onChange={(e) => setF({ ...f, incluidas: e.target.value })}
        />
      </Campo>
      <Campo label={t("admin.billingOverage")}>
        <input
          className={INPUT}
          inputMode="decimal"
          value={f.excedente}
          onChange={(e) => setF({ ...f, excedente: e.target.value })}
        />
      </Campo>
      <Campo label={t("admin.billingStripePrice")}>
        <input
          className={INPUT}
          placeholder="price_…"
          value={f.stripe}
          onChange={(e) => setF({ ...f, stripe: e.target.value })}
        />
      </Campo>
      <button
        type="button"
        disabled={guardando || !f.slug.trim() || !f.nombre.trim()}
        onClick={() =>
          onGuardar({
            slug: f.slug,
            nombre: f.nombre,
            // Se escribe en la moneda que se habla y se guarda en centavos: un
            // precio en float se convierte en 298,99999 después de dos cuentas.
            precio_centavos: Math.round(Number(f.precio) * 100),
            incluidas: Number(f.incluidas),
            excedente_centavos: Math.round(Number(f.excedente) * 100),
            stripe_price_id: f.stripe,
            stripe_price_excedente_id: f.stripeExc,
          })
        }
        className="h-[34px] rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {plan ? t("admin.billingSave") : t("admin.billingCreate")}
      </button>
    </div>
  );
}

function FormularioCuenta({
  cuenta,
  planes,
  guardando,
  onGuardar,
  onCerrar,
}: {
  cuenta: CuentaDelNegocio;
  planes: Plan[];
  guardando: boolean;
  onGuardar: (c: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const t = useT();
  const [f, setF] = useState({
    estado: cuenta.estado,
    plan_id: "",
    precio: "",
    incluidas: "",
    nota: cuenta.nota ?? "",
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{cuenta.nombre}</p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Campo label={t("admin.billingState")}>
          <select
            className={INPUT}
            value={f.estado}
            onChange={(e) => setF({ ...f, estado: e.target.value as typeof f.estado })}
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {t(`admin.billingState_${e}`)}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label={t("admin.billingPlans")}>
          <select
            className={INPUT}
            value={f.plan_id}
            onChange={(e) => setF({ ...f, plan_id: e.target.value })}
          >
            <option value="">{t("admin.billingKeep")}</option>
            {planes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label={t("admin.billingOwnPrice")}>
          <input
            className={INPUT}
            inputMode="decimal"
            placeholder={t("admin.billingKeep")}
            value={f.precio}
            onChange={(e) => setF({ ...f, precio: e.target.value })}
          />
        </Campo>
        <Campo label={t("admin.billingOwnIncluded")}>
          <input
            className={INPUT}
            inputMode="numeric"
            placeholder={t("admin.billingKeep")}
            value={f.incluidas}
            onChange={(e) => setF({ ...f, incluidas: e.target.value })}
          />
        </Campo>
        <Campo label={t("admin.billingNote")}>
          <input
            className={INPUT}
            value={f.nota}
            onChange={(e) => setF({ ...f, nota: e.target.value })}
          />
        </Campo>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={guardando}
          onClick={() =>
            onGuardar({
              workspace_id: cuenta.workspaceId,
              estado: f.estado,
              ...(f.plan_id ? { plan_id: f.plan_id } : {}),
              ...(f.precio !== ""
                ? { precio_centavos_override: Math.round(Number(f.precio) * 100) }
                : {}),
              ...(f.incluidas !== "" ? { incluidas_override: Number(f.incluidas) } : {}),
              nota: f.nota,
            })
          }
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {t("admin.billingSave")}
        </button>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("admin.billingCancel")}
        </button>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
