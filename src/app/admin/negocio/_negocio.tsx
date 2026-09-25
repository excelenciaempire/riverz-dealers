"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import type { ModeloCobro, Plan } from "@/lib/billing/plan";
import type { CuponDeStripe } from "@/lib/billing/stripe";
import type { CuentaDelNegocio, EstadoDePago, Negocio } from "@/lib/billing/negocio";
import {
  eligibleForFirstMonthOffer,
  firstMonthCents,
  FIRST_MONTH_DISCOUNT_PERCENT,
} from "@/lib/billing/first-month-offer";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * El negocio: cuánto entra, cuánto sale y qué paga cada comercio.
 *
 * Hasta acá no había forma de contestar «¿cuánto factura Riverz?». Se podía
 * operar la cuenta de un comercio de punta a punta y no había dónde anotar que
 * ese comercio paga.
 *
 * Cada cuenta muestra si ya paga en Stripe, no el estado interno: lo que hay
 * que saber de un comercio es si completó el link y si el cobro sigue entrando.
 * Las que todavía no pagan cuentan con MRR 0 y no se excluyen: el costo de
 * atenderlas es real y es justo lo que hay que mirar.
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

/** Cómo se ve cada estado de pago, en el orden del resumen. */
const PAGO: Record<EstadoDePago, { tono: Tone; etiqueta: string }> = {
  al_dia: { tono: "ok", etiqueta: "admin.billingPago_al_dia" },
  sin_pagar: { tono: "warn", etiqueta: "admin.billingPago_sin_pagar" },
  en_prueba: { tono: "muted", etiqueta: "admin.billingPago_en_prueba" },
  fallido: { tono: "error", etiqueta: "admin.billingPago_fallido" },
  cancelado: { tono: "error", etiqueta: "admin.billingPago_cancelado" },
  sin_mensualidad: { tono: "muted", etiqueta: "admin.billingPago_sin_mensualidad" },
  sin_configurar: { tono: "warn", etiqueta: "admin.billingPago_sin_configurar" },
};

const usd = (centavos: number) =>
  `US$${(centavos / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Un precio tal como se escribiría en el campo: con centavos sólo si los
 * tiene y sin separador de miles, que el campo leería como decimal.
 */
const usdExacto = (centavos: number) =>
  `US$${(centavos / 100).toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

/** Dólares escritos a mano, en centavos. `null` si no es un monto válido. */
function aCentavos(texto: string): number | null {
  const dolares = Number(texto.trim().replace(",", "."));
  return Number.isFinite(dolares) && dolares >= 0 ? Math.round(dolares * 100) : null;
}

/** El plan del acuerdo por saldo: mensualidad fija y el consumo desde la billetera. */
const PLAN_DE_SALDO = "saldo-ilimitado";

/** El plan de las cuentas BYOK: sin precio de lista, la mensualidad es de cada cuenta. */
const PLAN_BYOK = "byok";

/** El plan que lleva una cuenta con saldo o BYOK: no eligen plan de contactos. */
function planPropio(planes: Plan[], modelo: ModeloCobro): Plan | undefined {
  const slug = modelo === "saldo" ? PLAN_DE_SALDO : modelo === "byok" ? PLAN_BYOK : null;
  return planes.find((p) => p.slug === slug && p.activo);
}

/** Todo incluido sólo admite un plan de contactos activo. */
const esPlanOficial = (p: Plan | undefined): p is Plan => Boolean(p?.activo && p.incluidas > 0);

function nombrePlan(p: Plan, t: ReturnType<typeof useT>): string {
  switch (p.slug) {
    case "contactos-500": return t("settings.billingPlan500");
    case "contactos-2000": return t("settings.billingPlan2000");
    case "contactos-5000": return t("settings.billingPlan5000");
    case "contactos-10000": return t("settings.billingPlan10000");
    case "saldo-ilimitado": return t("settings.billingPlanSaldoUnlimited");
    case "byok": return t("settings.billingPlanByok");
    default: return p.nombre;
  }
}

/**
 * El negocio: cuánto entra, cuánto sale y qué paga cada comercio.
 *
 * Dos vistas de una sola lectura. `cuentas` contesta cómo viene el negocio y
 * qué paga cada comercio; `precios` es la perilla: los planes y las tarifas de
 * la billetera. Van en pestañas y no en dos pantallas porque salen del MISMO
 * pedido —`/api/admin/billing` trae planes, tarifas y cuentas juntos— y
 * separarlas serían dos consultas idénticas para mostrar mitades.
 */
export function Negocio({ vista }: { vista: "cuentas" | "precios" }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [dias, setDias] = useState(30);
  const [editando, setEditando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [alta, setAlta] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null);
  const [errorPlan, setErrorPlan] = useState<string | null>(null);

  const hasta = toDays(dias);
  const url =
    `/api/admin/billing?from=${encodeURIComponent(fromDays(dias))}` +
    (hasta ? `&to=${encodeURIComponent(hasta)}` : "");
  const { data, loading, error, reload, live } = useAdminData<Payload>(url);

  /** `true` si quedó guardado: el link de pago se arma recién después. */
  const guardarCuenta = async (cuenta: Record<string, unknown>): Promise<boolean> => {
    setGuardando(true);
    setErrorCuenta(null);
    try {
      const res = await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorCuenta(json?.error ?? t("admin.billingSaveFailed"));
        return false;
      }
      reload();
      return true;
    } catch {
      setErrorCuenta(t("admin.billingSaveFailed"));
      return false;
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Dar de alta un comercio, con su trato ya definido.
   *
   * En esta etapa las cuentas no se crean solas: se le instala Riverz a un
   * comercio concreto. Hacerlo en dos pasos —que se registre, y despues
   * buscarlo para configurarlo— deja una ventana en la que la cuenta existe
   * con un trato que nadie eligio.
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
        setErrorAlta(json.error ?? t("admin.billingSaveFailed"));
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
    setErrorPlan(null);
    try {
      const res = await fetchWithCsrf("/api/admin/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorPlan(json?.error ?? t("admin.billingSaveFailed"));
        return;
      }
      reload();
    } catch {
      setErrorPlan(t("admin.billingSaveFailed"));
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
            {c.correo && <Muted>{c.correo}</Muted>}
          </div>
        ),
      },
      {
        key: "pago",
        header: t("admin.billingPayment"),
        cell: (c) => <EstadoDelPago cuenta={c} />,
      },
      {
        key: "plan",
        header: t("admin.billingPlan"),
        cell: (c) => {
          const plan = data?.planes.find((p) => p.slug === c.planSlug);
          return <span>{plan ? nombrePlan(plan, t) : c.plan ?? "—"}</span>;
        },
      },
      {
        key: "mensualidad",
        header: t("admin.billingMonthlyFee"),
        cell: (c) => (
          <span className="tabular-nums">
            {c.precioAcuerdoCentavos > 0 ? usd(c.precioAcuerdoCentavos) : "—"}
          </span>
        ),
      },
      {
        key: "modelo",
        header: t("admin.billingModel"),
        cell: (c) => (c.tieneSuscripcion ? t(`admin.billingModel_${c.modeloCobro}`) : "—"),
      },
      {
        key: "uso",
        header: t("admin.billingUsage"),
        cell: (c) => (
          <span className="tabular-nums">
            {(c.modeloCobro === "oficial" ? c.contactosAtendidos : c.conversaciones).toLocaleString()}
            <Muted> {t(c.modeloCobro === "oficial" ? "admin.billingContactsShort" : "admin.billingConversationsShort")}</Muted>
            <Muted> · US${c.costoUsd.toFixed(2)}</Muted>
          </span>
        ),
      },
      {
        key: "saldo",
        header: t("admin.walletBalance"),
        cell: (c) => {
          if (c.modeloCobro !== "saldo") return <Muted>—</Muted>;
          // El rojo es sólo cuando el saldo cero APAGA la IA, como lo decide la
          // puerta: la cuenta que todavía no paga el link nunca se apaga.
          const apagada = c.tieneSuscripcion && c.estado !== "cortesia" && c.saldoCentavos <= 0;
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
            onClick={() => {
              setErrorCuenta(null);
              setEditando(c.workspaceId);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t("admin.billingEdit")}
          </button>
        ),
      },
    ],
    [data, t],
  );

  if (loading && !data) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const { negocio, planes, tarifas } = data;
  const cuentaEditada = negocio.cuentas.find((c) => c.workspaceId === editando);
  const termino = busqueda.trim().toLocaleLowerCase();
  const cuentasFiltradas = termino
    ? negocio.cuentas.filter((c) => `${c.nombre} ${c.correo ?? ""}`.toLocaleLowerCase().includes(termino))
    : negocio.cuentas;

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
          hint={t("admin.billingPaying", { n: negocio.pagando })}
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
          {(Object.keys(PAGO) as EstadoDePago[])
            .filter((p) => negocio.porPago[p] > 0)
            .map((p) => (
              <span key={p} className="tabular-nums">
                <strong className="text-foreground">{negocio.porPago[p]}</strong>{" "}
                <Muted>{t(PAGO[p].etiqueta)}</Muted>
              </span>
            ))}
        </div>
      </Panel>

      {vista === "cuentas" ? (
        <Panel title={t("admin.billingAccounts")}>
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <input
              type="search"
              className={`${INPUT} max-w-xs`}
              aria-label={t("admin.billingSearchAccounts")}
              placeholder={t("admin.billingSearchAccounts")}
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
            />
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
                planes={planes.filter((p) => p.activo)}
                guardando={guardando}
                error={errorAlta}
                onCrear={crearCuenta}
                onCerrar={() => setAlta(false)}
              />
            </div>
          )}
          <DataTable rows={cuentasFiltradas} columns={columns} rowKey={(c) => c.workspaceId} />
        </Panel>
      ) : (
        <>
          <Panel title={t("admin.billingPlans")}>
            <div className="space-y-3 p-4">
              {errorPlan && <p className="text-sm text-destructive">{errorPlan}</p>}
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
        </>
      )}

      <Dialog
        open={Boolean(editando) && vista === "cuentas"}
        onOpenChange={(open) => {
          if (!open && !guardando) setEditando(null);
        }}
      >
        {cuentaEditada && (
          <DialogContent className="gap-0 p-0 sm:max-w-2xl" showCloseButton={!guardando}>
            <DialogHeader className="border-b border-border px-5 py-4 pr-12">
              <DialogTitle>{t("admin.billingEditTitle")}</DialogTitle>
              <DialogDescription>{cuentaEditada.nombre}</DialogDescription>
            </DialogHeader>
            <div className="space-y-5 p-5">
              <FormularioCuenta
                key={cuentaEditada.workspaceId}
                cuenta={cuentaEditada}
                planes={planes}
                guardando={guardando}
                error={errorCuenta}
                onGuardar={guardarCuenta}
                onCerrar={() => setEditando(null)}
                onMover={moverSaldo}
                onBloqueo={cambiarBloqueo}
              />
            </div>
          </DialogContent>
        )}
      </Dialog>
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

  const cargar = () => {
    const dolares = Number(monto.replace(",", "."));
    if (!Number.isFinite(dolares) || dolares === 0) return;
    onMover({
      workspace_id: cuenta.workspaceId,
      centavos: Math.round(dolares * 100),
      tipo: "bono",
    });
    setMonto("");
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
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
      <div className="flex items-end gap-2">
        <div className="w-40">
          <Campo label={t("admin.walletGrantAmount")}>
            <input
              className={INPUT}
              inputMode="decimal"
              placeholder="50"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </Campo>
        </div>
        <button
          type="button"
          disabled={guardando || !monto}
          onClick={cargar}
          className="h-[34px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
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
    activo: plan?.activo ?? true,
    precio: String((plan?.precioCentavos ?? 0) / 100),
    incluidas: String(plan?.incluidas ?? 0),
    excedente: String((plan?.excedenteCentavos ?? 0) / 100),
    stripe: plan?.stripePriceId ?? "",
    stripeExc: plan?.stripePriceExcedenteId ?? "",
  });

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-xl border border-border p-3 lg:grid-cols-8">
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
      <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
        <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
        {t("admin.billingPlanActive")}
      </label>
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
            activo: f.activo,
            // Se escribe en la moneda que se habla y se guarda en centavos: un
            // precio en float se convierte en 298,99999 después de dos cuentas.
            precio_centavos: Math.round(Number(f.precio) * 100),
            incluidas: Number(f.incluidas),
            excedente_centavos: Math.round(Number(f.excedente) * 100),
            stripe_price_id: f.stripe,
            stripe_price_excedente_id: f.stripeExc,
            orden: plan?.orden ?? 999,
          })
        }
        className="h-[34px] rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {plan ? t("admin.billingSave") : t("admin.billingCreate")}
      </button>
    </div>
  );
}

/**
 * El trato de una cuenta —con saldo, con plan o BYOK— y su cobro.
 *
 * Cada sistema de cobro muestra sólo lo suyo. Con plan elige un plan de
 * contactos y su cupo. Con saldo no tiene cupo ni plan que elegir: lleva el
 * plan de saldo, una mensualidad y la billetera. BYOK lleva la mensualidad que
 * se pacta con la cuenta, y la IA corre con su propia clave de Anthropic.
 *
 * El estado no se elige acá: con mensualidad, la cuenta usa la app pero no la
 * IA hasta que paga el link, y Stripe la pasa a activa; sin mensualidad
 * arranca ya.
 */
function FormularioCuenta({
  cuenta,
  planes,
  guardando,
  error,
  onGuardar,
  onCerrar,
  onMover,
  onBloqueo,
}: {
  cuenta: CuentaDelNegocio;
  planes: Plan[];
  guardando: boolean;
  error: string | null;
  onGuardar: (c: Record<string, unknown>) => Promise<boolean>;
  onCerrar: () => void;
  onMover: (s: Record<string, unknown>) => void;
  onBloqueo: (workspaceId: string, cambio: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [f, setF] = useState({
    modelo: cuenta.modeloCobro,
    plan_id: "",
    precio: "",
    incluidas: "",
  });
  const oficial = f.modelo === "oficial";
  const planActual = planes.find((p) => p.slug === cuenta.planSlug);
  const planDeSaldo = planPropio(planes, "saldo");
  // El plan con el que queda la cuenta al guardar.
  const plan = f.plan_id ? planes.find((p) => p.id === f.plan_id) : planActual;
  const planValido = f.modelo === "saldo" ||
    (f.modelo === "byok" ? plan?.slug === PLAN_BYOK : esPlanOficial(plan));
  const precioEscrito = f.precio.trim() !== "";
  const precio = aCentavos(f.precio);
  const precioValido = !precioEscrito || precio !== null;
  const incluidasEscritas = f.incluidas.trim();
  const incluidasValidas = !oficial || incluidasEscritas === "" ||
    (Number.isInteger(Number(incluidasEscritas)) && Number(incluidasEscritas) >= 0);
  const valido = planValido && precioValido && incluidasValidas;
  // La mensualidad pactada al guardar: la escrita, la del plan nuevo o la de hoy.
  const mensualidad = precioEscrito
    ? precio ?? 0
    : f.plan_id ? plan?.precioCentavos ?? 0 : cuenta.precioAcuerdoCentavos;
  const pendiente = !cuenta.tieneSuscripcion || f.modelo !== cuenta.modeloCobro ||
    plan?.id !== planActual?.id || mensualidad !== cuenta.precioAcuerdoCentavos ||
    (oficial && incluidasEscritas !== "");
  // Con mensualidad y sin pagar, la cuenta que hoy usa la IA la deja de usar
  // hasta que pague el link.
  const pausaLaIa = pendiente && valido && mensualidad > 0 && !cuenta.suscripcionExterna &&
    (cuenta.estado === "activa" || cuenta.estado === "sin_configurar");
  // Stripe no cobra un plan que ya no se vende: primero se elige uno activo.
  const cobraConLink = cuenta.admiteLinkPago && valido && Boolean(plan) && mensualidad > 0;
  // La promoción del primer mes con el trato como va a quedar: la misma
  // cuenta que hace el checkout.
  const conPromo = !cuenta.suscripcionExterna && eligibleForFirstMonthOffer({
    modeloCobro: f.modelo,
    plan: plan ? { slug: plan.slug } : null,
    stripeSubscriptionId: null,
    precioAcuerdoCentavos: mensualidad,
  });

  const cambiarModelo = (modelo: ModeloCobro) =>
    setF({
      ...f,
      modelo,
      // Saldo y BYOK llevan su plan. Una cuenta que ya está en ese sistema
      // conserva el suyo: cambiarlo mueve su cobro, y eso se elige a propósito.
      plan_id: modelo !== "oficial" && cuenta.modeloCobro !== modelo ? planPropio(planes, modelo)?.id ?? "" : "",
      precio: "",
      incluidas: "",
    });

  /** Guarda lo que falte. `true` si lo guardado es lo que muestra el formulario. */
  const guardarPendiente = async () => {
    if (!pendiente) return true;
    if (!valido) return false;
    return onGuardar({
      workspace_id: cuenta.workspaceId,
      modelo_cobro: f.modelo,
      ...(f.plan_id ? { plan_id: f.plan_id } : {}),
      ...(precioEscrito
        ? { precio_centavos_override: precio }
        : f.plan_id ? { precio_centavos_override: null } : {}),
      ...(oficial && incluidasEscritas !== ""
        ? { incluidas_override: Number(incluidasEscritas) }
        : f.plan_id ? { incluidas_override: null, excedente_centavos_override: null } : {}),
    });
  };

  const guardar = async () => {
    if (await guardarPendiente()) onCerrar();
  };

  return (
    <>
      <div className="space-y-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label={t("admin.billingModel")}>
            <select
              className={INPUT}
              value={f.modelo}
              onChange={(e) => cambiarModelo(e.target.value as ModeloCobro)}
            >
              <option value="saldo">{t("admin.billingModel_saldo")}</option>
              <option value="oficial">{t("admin.billingModel_oficial")}</option>
              <option value="byok">{t("admin.billingModel_byok")}</option>
            </select>
          </Campo>
          {oficial ? (
            <Campo label={t("admin.billingPlan")}>
              <select
                className={INPUT}
                value={f.plan_id}
                onChange={(e) => setF({ ...f, plan_id: e.target.value })}
              >
                <option value="">
                  {esPlanOficial(planActual)
                    ? `${t("admin.billingKeep")} · ${nombrePlan(planActual, t)}`
                    : t("admin.billingChoosePlan")}
                </option>
                {planes.filter(esPlanOficial).map((p) => (
                  <option key={p.id} value={p.id}>
                    {nombrePlan(p, t)}
                  </option>
                ))}
              </select>
            </Campo>
          ) : (
            <Campo label={t("admin.billingMonthlyFee")}>
              <input
                className={INPUT}
                inputMode="decimal"
                placeholder={usdExacto(f.plan_id ? plan?.precioCentavos ?? 0 : cuenta.precioAcuerdoCentavos)}
                value={f.precio}
                onChange={(e) => setF({ ...f, precio: e.target.value })}
              />
            </Campo>
          )}
          {/* Sólo una cuenta que ya estaba en saldo con otro plan elige: pasarla
              al plan de saldo cambia lo que paga. */}
          {f.modelo === "saldo" && cuenta.modeloCobro === "saldo" && planDeSaldo && planActual?.id !== planDeSaldo.id && (
            <div className="sm:col-span-2">
              <Campo label={t("admin.billingPlan")}>
                <select
                  className={INPUT}
                  value={f.plan_id}
                  onChange={(e) => setF({ ...f, plan_id: e.target.value })}
                >
                  <option value="">
                    {planActual ? `${t("admin.billingKeep")} · ${nombrePlan(planActual, t)}` : t("admin.billingKeep")}
                  </option>
                  <option value={planDeSaldo.id}>{nombrePlan(planDeSaldo, t)}</option>
                </select>
              </Campo>
            </div>
          )}
          {oficial && (
            <>
              <Campo label={t("admin.billingOwnPrice")}>
                <input
                  className={INPUT}
                  inputMode="decimal"
                  placeholder={esPlanOficial(plan)
                    ? usdExacto(f.plan_id ? plan.precioCentavos : cuenta.precioAcuerdoCentavos)
                    : undefined}
                  value={f.precio}
                  onChange={(e) => setF({ ...f, precio: e.target.value })}
                />
              </Campo>
              <Campo label={t("admin.billingOwnIncluded")}>
                <input
                  className={INPUT}
                  inputMode="numeric"
                  placeholder={esPlanOficial(plan)
                    ? String(f.plan_id ? plan.incluidas : cuenta.incluidas)
                    : undefined}
                  value={f.incluidas}
                  onChange={(e) => setF({ ...f, incluidas: e.target.value })}
                />
              </Campo>
            </>
          )}
        </div>
        {f.modelo === "byok" && !cuenta.tieneClavePropia && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t("admin.billingByokNoKey")}</p>
        )}
        {pausaLaIa && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t("admin.billingPausesAi")}</p>
        )}
      </div>
      <Cobro
        cuenta={cuenta}
        disponible={cobraConLink && Boolean(plan?.activo)}
        planInactivo={cobraConLink && !plan?.activo}
        mensualidadCentavos={mensualidad}
        conPromo={conPromo}
        trato={`${f.modelo}|${plan?.id ?? ""}|${mensualidad}`}
        ocupado={guardando}
        antesDeArmar={guardarPendiente}
      />
      {f.modelo === "saldo" ? (
        <BloqueBilletera
          cuenta={cuenta}
          guardando={guardando}
          onMover={onMover}
          onBloqueo={onBloqueo}
        />
      ) : oficial ? (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {t("admin.billingModelOfficialNote")}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
        <button
          type="button"
          disabled={guardando}
          onClick={onCerrar}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {t("admin.billingCancel")}
        </button>
        <button
          type="button"
          disabled={guardando || !valido}
          onClick={guardar}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {t("admin.billingSave")}
        </button>
      </div>
    </>
  );
}

/**
 * Alta de un comercio.
 *
 * Con mensualidad nace sin pagar: usa la app pero no la IA hasta que paga el
 * link, y Stripe la pasa a activa.
 */
function FormularioAlta({
  planes,
  guardando,
  error,
  onCrear,
  onCerrar,
}: {
  planes: Plan[];
  guardando: boolean;
  error: string | null;
  onCrear: (c: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const t = useT();
  const planesOficiales = planes.filter(esPlanOficial);
  const [f, setF] = useState({
    email: "",
    nombre: "",
    modelo: "oficial" as ModeloCobro,
    plan_id: planesOficiales[0]?.id ?? "",
    precio: "",
  });
  const oficial = f.modelo === "oficial";
  const plan = planes.find((p) => p.id === f.plan_id);
  const precio = aCentavos(f.precio);
  const precioEscrito = f.precio.trim() !== "";

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
        <Campo label={t("admin.billingModel")}>
          <select
            className={INPUT}
            value={f.modelo}
            onChange={(e) => {
              const modelo = e.target.value as ModeloCobro;
              setF({
                ...f,
                modelo,
                plan_id: (modelo === "oficial" ? planesOficiales[0] : planPropio(planes, modelo))?.id ?? "",
                precio: "",
              });
            }}
          >
            <option value="saldo">{t("admin.billingModel_saldo")}</option>
            <option value="oficial">{t("admin.billingModel_oficial")}</option>
            <option value="byok">{t("admin.billingModel_byok")}</option>
          </select>
        </Campo>
        {oficial && (
          <Campo label={t("admin.billingPlan")}>
            <select className={INPUT} value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })}>
              {planesOficiales.map((p) => <option key={p.id} value={p.id}>{nombrePlan(p, t)}</option>)}
            </select>
          </Campo>
        )}
        <Campo label={t(oficial ? "admin.billingOwnPrice" : "admin.billingMonthlyFee")}>
          <input
            className={INPUT}
            inputMode="decimal"
            placeholder={plan ? usdExacto(plan.precioCentavos) : undefined}
            value={f.precio}
            onChange={(e) => setF({ ...f, precio: e.target.value })}
          />
        </Campo>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={guardando || !f.email.trim() || (precioEscrito && precio === null) ||
            (f.modelo === "byok" && plan?.slug !== PLAN_BYOK)}
          onClick={() =>
            onCrear({
              email: f.email,
              nombre: f.nombre,
              modelo_cobro: f.modelo,
              plan_id: f.plan_id || undefined,
              ...(precioEscrito && precio !== null ? { precio_centavos: precio } : {}),
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

/** Si la cuenta ya paga en Stripe y, si paga, cuándo vuelve a cobrarse. */
function EstadoDelPago({ cuenta }: { cuenta: CuentaDelNegocio }) {
  const t = useT();
  const fmt = useFormat();
  const { tono, etiqueta } = PAGO[cuenta.pago];
  const dia = (iso: string | null) => (iso ? fmt.date(iso, { day: "numeric", month: "short" }) : null);
  const detalle = cuenta.pago === "al_dia" && cuenta.periodoHasta
    ? t(cuenta.cancelarAlFinal ? "admin.billingEndsOn" : "admin.billingNextCharge", { date: dia(cuenta.periodoHasta) ?? "" })
    : cuenta.pago === "en_prueba" && cuenta.pruebaHasta
      ? t("admin.billingTrialUntil", { date: dia(cuenta.pruebaHasta) ?? "" })
      : null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <StatusPill tone={tono} label={t(etiqueta)} />
      {detalle && <Muted>· {detalle}</Muted>}
    </span>
  );
}

/** Valor del selector para el link cuyo primer mes no se cobra. */
const PRIMER_MES_SIN_CARGO = "primer-mes-sin-cargo";

/**
 * El cobro de la cuenta: si ya paga en Stripe y, si todavía no, su link.
 *
 * El link existe para que cerrar un cliente no dependa de que alguien con la
 * clave secreta arme la sesión de Stripe a mano. Stripe cobra lo guardado, así
 * que armarlo guarda antes lo que haya cambiado en el formulario.
 *
 * El descuento se ELIGE de los cupones que ya están en Stripe: inventarlo acá
 * sería poder regalar plata con un click, y sin rastro de quién lo hizo. Las
 * excepciones son la promoción del primer mes y el primer mes sin cargo, para
 * quien ya lo pagó por fuera, y quedan en la auditoría.
 */
function Cobro({
  cuenta,
  disponible,
  planInactivo,
  mensualidadCentavos,
  conPromo,
  trato,
  ocupado,
  antesDeArmar,
}: {
  cuenta: CuentaDelNegocio;
  /** Se puede armar el link con el trato del formulario. */
  disponible: boolean;
  /** Cobraría con link, pero el plan ya no se vende. */
  planInactivo: boolean;
  mensualidadCentavos: number;
  conPromo: boolean;
  /** El trato del formulario: un link armado con otro cobraría otra cosa. */
  trato: string;
  ocupado: boolean;
  antesDeArmar: () => Promise<boolean>;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [cupones, setCupones] = useState<CuponDeStripe[] | null>(null);
  const [primerMes, setPrimerMes] = useState("");
  const [link, setLink] = useState<{ url: string; para: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armando, setArmando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const sinCargo = primerMes === PRIMER_MES_SIN_CARGO;
  const para = `${trato}|${primerMes}`;
  const url = link?.para === para ? link.url : null;
  // Lo que se cobra el primer mes. Con un cupón de Stripe lo dice el cupón.
  const primero = sinCargo ? 0 : !primerMes && conPromo ? firstMonthCents(mensualidadCentavos) : null;
  const pedirCupones = disponible && cupones === null;

  useEffect(() => {
    if (!pedirCupones) return;
    let vivo = true;
    fetch("/api/admin/billing/link")
      .then((r) => r.json())
      .then((d: { cupones?: CuponDeStripe[] }) => {
        if (vivo) setCupones(d.cupones ?? []);
      })
      .catch(() => {
        if (vivo) setCupones([]);
      });
    return () => {
      vivo = false;
    };
  }, [pedirCupones]);

  async function armar() {
    setError(null);
    setCopiado(false);
    if (!(await antesDeArmar())) return;
    setArmando(true);
    try {
      const res = await fetchWithCsrf("/api/admin/billing/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: cuenta.workspaceId,
          cupon: sinCargo ? null : primerMes || null,
          primer_mes_sin_cargo: sinCargo,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && d.url) setLink({ url: d.url, para });
      else setError(d.error ?? t("admin.billingLinkFailed"));
    } catch {
      setError(t("admin.billingLinkFailed"));
    } finally {
      setArmando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-foreground">{t("admin.billingPayment")}</span>
        <EstadoDelPago cuenta={cuenta} />
      </div>
      {planInactivo && (
        <p className="text-xs text-muted-foreground">{t("admin.billingChooseActivePlan")}</p>
      )}
      {disponible && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <Campo label={t("admin.billingFirstMonth")}>
                <select
                  className={INPUT}
                  value={primerMes}
                  onChange={(e) => {
                    setPrimerMes(e.target.value);
                    setError(null);
                  }}
                >
                  <option value="">
                    {conPromo
                      ? t("admin.billingFirstMonthPromo", { percent: FIRST_MONTH_DISCOUNT_PERCENT })
                      : t("admin.billingFullPrice")}
                  </option>
                  <option value={PRIMER_MES_SIN_CARGO}>{t("admin.billingFirstMonthFree")}</option>
                  {(cupones ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.detalle}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <button
              type="button"
              disabled={ocupado || armando}
              onClick={armar}
              className="h-[34px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.billingPayLink")}
            </button>
          </div>
          {primero !== null && (
            <p className="text-xs text-muted-foreground">
              {t("admin.billingFirstMonthSummary", {
                first: usd(primero),
                regular: usd(mensualidadCentavos),
              })}
            </p>
          )}
          {url && (
            <div className="flex items-center gap-2">
              <input readOnly value={url} className={`${INPUT} min-w-0 flex-1`} />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  setCopiado(true);
                }}
                className="h-[34px] shrink-0 rounded-lg border border-border px-3 text-xs font-medium text-foreground"
              >
                {copiado ? t("admin.billingCopied") : t("admin.billingCopy")}
              </button>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
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
