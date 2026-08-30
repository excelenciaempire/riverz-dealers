"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import type { Plan } from "@/lib/billing/plan";
import type { CuponDeStripe } from "@/lib/billing/stripe";
import type { CuentaDelNegocio, Negocio } from "@/lib/billing/negocio";
import type { Tarifa } from "@/lib/wallet/tarifas";
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
import { RangePicker, RefreshButton, fromDays, toDays } from "../_components/filters";

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
  tarifas: Tarifa[];
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
  const [alta, setAlta] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  const hasta = toDays(dias);
  const url =
    `/api/admin/billing?from=${encodeURIComponent(fromDays(dias))}` +
    (hasta ? `&to=${encodeURIComponent(hasta)}` : "");
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

  /**
   * Dar de alta un comercio, con su trato ya definido.
   *
   * En esta etapa las cuentas no se crean solas: se le instala Riverz a un
   * comercio concreto, casi siempre sin cargo. Hacerlo en dos pasos —que se
   * registre, y despues buscarlo para configurarlo— deja una ventana en la que
   * la cuenta existe con un trato que nadie eligio.
   */
  const crearCuenta = async (cuenta: Record<string, unknown>) => {
    setGuardando(true);
    try {
      const res = await fetchWithCsrf("/api/admin/billing/cuenta-nueva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuenta),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (json.ok) {
        setAlta(false);
        reload();
      } else {
        setErrorAlta(json.error ?? "no se pudo");
      }
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Cargar saldo a mano: el bono del piloto, la disculpa por una falla, la
   * corrección de un cobro mal hecho. No edita el libro —es append-only— sino
   * que le agrega una línea, y queda auditado.
   */
  const moverSaldo = async (saldo: Record<string, unknown>) => {
    setGuardando(true);
    try {
      await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saldo }),
      });
      reload();
    } finally {
      setGuardando(false);
    }
  };

  const cambiarBloqueo = async (
    workspace_id: string,
    cambio: Record<string, unknown>,
  ) => {
    setGuardando(true);
    try {
      await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billetera: { workspace_id, ...cambio } }),
      });
      reload();
    } finally {
      setGuardando(false);
    }
  };

  const guardarTarifa = async (tarifa: Record<string, unknown>) => {
    setGuardando(true);
    try {
      await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarifa }),
      });
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
        key: "saldo",
        header: t("admin.walletBalance"),
        cell: (c) => {
          // El rojo es sólo cuando el saldo cero APAGA algo. Pintar en rojo a
          // una cuenta de cortesía —que nunca se apaga— es inventar una alarma.
          const apagada = c.bloqueaSinSaldo && c.saldoCentavos <= 0;
          return (
            <span className="tabular-nums">
              <span className={apagada ? "text-destructive" : undefined}>
                {usd(c.saldoCentavos)}
              </span>
              {c.gastadoCentavos > 0 && <Muted> · −{usd(c.gastadoCentavos)}</Muted>}
              {apagada && <Muted> · {t("admin.walletOff")}</Muted>}
            </span>
          );
        },
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

  const { negocio, planes, tarifas } = data;

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label={t("admin.walletLoaded")}
          value={usd(negocio.cargadoCentavos)}
          tone="ok"
          hint={t("admin.walletLoadedHint")}
        />
        <Stat
          label={t("admin.walletSpent")}
          value={usd(negocio.gastadoCentavos)}
          hint={
            negocio.margenBilleteraPct === null
              ? t("admin.billingNoMargin")
              : t("admin.billingMargin", { n: negocio.margenBilleteraPct })
          }
        />
        <Stat
          label={t("admin.walletFloat")}
          value={usd(negocio.saldoTotalCentavos)}
          hint={t("admin.walletFloatHint")}
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

      <Panel title={t("admin.walletRates")}>
        <div className="space-y-2 p-4">
          {(tarifas ?? []).map((tar) => (
            <FilaTarifa
              key={tar.concepto}
              tarifa={tar}
              guardando={guardando}
              onGuardar={guardarTarifa}
            />
          ))}
        </div>
      </Panel>

      <Panel title={t("admin.billingAccounts")}>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <Muted>{t("admin.billingNewHint")}</Muted>
          <button
            type="button"
            onClick={() => {
              setAlta((v) => !v);
              setErrorAlta(null);
            }}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {t("admin.billingNew")}
          </button>
        </div>
        {alta && (
          <div className="border-b border-border p-4">
            <FormularioAlta
              guardando={guardando}
              error={errorAlta}
              onCrear={crearCuenta}
              onCerrar={() => setAlta(false)}
            />
          </div>
        )}
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
            <BloqueBilletera
              cuenta={negocio.cuentas.find((c) => c.workspaceId === editando)!}
              guardando={guardando}
              onMover={moverSaldo}
              onBloqueo={cambiarBloqueo}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}


/**
 * La billetera de una cuenta, desde el panel.
 *
 * Dos perillas y nada más: cargarle saldo y decidir si quedarse sin saldo le
 * apaga la IA. El interruptor está acá y no en un ajuste global porque una
 * cuenta de piloto que nunca cargó no puede quedarse muda porque se prendió una
 * regla nueva para todos.
 *
 * El saldo no se "edita": se le suma una línea al libro. Poner un número y que
 * el anterior desaparezca haría imposible contestar "¿por qué tenía 40 dólares
 * el martes?".
 */
function BloqueBilletera({
  cuenta,
  guardando,
  onMover,
  onBloqueo,
}: {
  cuenta: CuentaDelNegocio;
  guardando: boolean;
  onMover: (s: Record<string, unknown>) => void;
  onBloqueo: (workspaceId: string, cambio: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");

  const cargar = () => {
    const dolares = Number(monto.replace(",", "."));
    if (!Number.isFinite(dolares) || dolares === 0) return;
    onMover({
      workspace_id: cuenta.workspaceId,
      centavos: Math.round(dolares * 100),
      tipo: "bono",
      motivo,
    });
    setMonto("");
    setMotivo("");
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground">
          {t("admin.walletBalance")}:{" "}
          <span className="tabular-nums font-medium">{usd(cuenta.saldoCentavos)}</span>
          <Muted>
            {" "}
            · {t("admin.walletLoaded")} {usd(cuenta.cargadoCentavos)} ·{" "}
            {t("admin.walletSpent")} {usd(cuenta.gastadoCentavos)}
          </Muted>
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={cuenta.bloqueaSinSaldo}
              disabled={guardando}
              onChange={(e) =>
                onBloqueo(cuenta.workspaceId, { bloquear_sin_saldo: e.target.checked })
              }
            />
            {t("admin.walletBlockToggle")}
          </label>
          {/* Pasarle el costo sin margen. Es por cuenta y no global: al primer
              cliente se le pasa a costo mientras el precio se descubre; al que
              entre en seis meses, no. */}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={cuenta.cobraACosto}
              disabled={guardando}
              onChange={(e) =>
                onBloqueo(cuenta.workspaceId, { cobrar_a_costo: e.target.checked })
              }
            />
            {t("admin.walletAtCost")}
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 items-end gap-2 lg:grid-cols-4">
        <Campo label={t("admin.walletGrantAmount")}>
          <input
            className={INPUT}
            inputMode="decimal"
            placeholder="50"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
        </Campo>
        <Campo label={t("admin.walletGrantWhy")}>
          <input
            className={INPUT}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </Campo>
        <button
          type="button"
          disabled={guardando || !monto}
          onClick={cargar}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {t("admin.walletGrant")}
        </button>
      </div>
    </div>
  );
}


/**
 * Una tarifa, editable en su fila.
 *
 * El precio se muestra en dólares por unidad —que es como se piensa— y se
 * guarda en milésimas de centavo, que es como se cobra sin redondear de más
 * cada respuesta. Tres decimales alcanzan: por debajo de un décimo de centavo
 * la diferencia no se ve ni en mil respuestas.
 */
function FilaTarifa({
  tarifa,
  guardando,
  onGuardar,
}: {
  tarifa: Tarifa;
  guardando: boolean;
  onGuardar: (t: Record<string, unknown>) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [precio, setPrecio] = useState(String(tarifa.precioMilicentavos / 100000));

  const guardar = () => {
    const dolares = Number(precio.replace(",", "."));
    if (!Number.isFinite(dolares) || dolares < 0) return;
    onGuardar({
      concepto: tarifa.concepto,
      precio_milicentavos: Math.round(dolares * 100000),
      activo: tarifa.activo,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 text-sm">
      <span className="min-w-40 flex-1 text-foreground">
        {locale === "en" ? tarifa.nombreEn : tarifa.nombreEs}
      </span>
      <span className="w-28">
        <input
          className={INPUT}
          inputMode="decimal"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
        />
      </span>
      <Muted>US$ / {tarifa.unidad}</Muted>
      <button
        type="button"
        disabled={guardando}
        onClick={guardar}
        className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-60"
      >
        {t("admin.billingSave")}
      </button>
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
      <LinkDePago workspaceId={cuenta.workspaceId} />
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

/**
 * Alta de un comercio.
 *
 * Nace en cortesia por defecto porque es lo que pasa de verdad hoy: se le
 * instala sin cargo. El estado se puede cambiar en el mismo formulario, pero el
 * defecto tiene que ser el caso real, no el que suena mas prolijo.
 */
function FormularioAlta({
  guardando,
  error,
  onCrear,
  onCerrar,
}: {
  guardando: boolean;
  error: string | null;
  onCrear: (c: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const t = useT();
  const [f, setF] = useState({
    email: "",
    nombre: "",
    estado: "cortesia" as "cortesia" | "prueba" | "activa",
    precio: "",
    nota: "",
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Campo label={t("admin.billingEmail")}>
          <input
            className={INPUT}
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </Campo>
        <Campo label={t("admin.billingName")}>
          <input
            className={INPUT}
            value={f.nombre}
            onChange={(e) => setF({ ...f, nombre: e.target.value })}
          />
        </Campo>
        <Campo label={t("admin.billingState")}>
          <select
            className={INPUT}
            value={f.estado}
            onChange={(e) => setF({ ...f, estado: e.target.value as typeof f.estado })}
          >
            <option value="cortesia">{t("admin.billingState_cortesia")}</option>
            <option value="prueba">{t("admin.billingState_prueba")}</option>
            <option value="activa">{t("admin.billingState_activa")}</option>
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
        <Campo label={t("admin.billingNote")}>
          <input
            className={INPUT}
            value={f.nota}
            onChange={(e) => setF({ ...f, nota: e.target.value })}
          />
        </Campo>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={guardando || !f.email.trim()}
          onClick={() =>
            onCrear({
              email: f.email,
              nombre: f.nombre,
              estado: f.estado,
              nota: f.nota,
              ...(f.precio !== ""
                ? { precio_centavos: Math.round(Number(f.precio) * 100) }
                : {}),
            })
          }
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {t("admin.billingInvite")}
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

/**
 * El link de pago de esta cuenta.
 *
 * Existe para que cerrar un cliente no dependa de que alguien con la clave
 * secreta arme la sesión de Stripe a mano. El descuento se ELIGE de los cupones
 * que ya están en Stripe: inventarlo acá sería poder regalar plata con un
 * click, y sin rastro de quién lo hizo.
 */
function LinkDePago({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [cupones, setCupones] = useState<CuponDeStripe[] | null>(null);
  const [cupon, setCupon] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/admin/billing/link")
      .then((r) => r.json())
      .then((d) => {
        if (vivo) setCupones((d.cupones as CuponDeStripe[]) ?? []);
      })
      .catch(() => {
        if (vivo) setCupones([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function generar() {
    setPidiendo(true);
    setError(null);
    setUrl(null);
    try {
      const res = await fetchWithCsrf("/api/admin/billing/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, cupon: cupon || null }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "no se pudo");
      else setUrl(d.url as string);
    } catch {
      setError("no se pudo");
    } finally {
      setPidiendo(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <Campo label={t("admin.billingCoupon")}>
        <select
          className={INPUT}
          value={cupon}
          onChange={(e) => setCupon(e.target.value)}
        >
          <option value="">{t("admin.billingNoCoupon")}</option>
          {(cupones ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} {c.detalle}
            </option>
          ))}
        </select>
      </Campo>
      <button
        type="button"
        disabled={pidiendo}
        onClick={generar}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
      >
        {t("admin.billingPayLink")}
      </button>
      {url && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input readOnly value={url} className={`${INPUT} min-w-0 flex-1`} />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopiado(true);
            }}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {copiado ? t("admin.billingCopied") : t("admin.billingCopy")}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
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
