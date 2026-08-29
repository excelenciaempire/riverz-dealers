'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { avisarSaldoCambio } from '@/hooks/use-saldo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * El saldo, y en qué se fue.
 *
 * El comercio no tiene por qué enterarse de que atrás hay tres proveedores con
 * tres facturas. Carga saldo y ve una sola cuenta: cuánto le queda, cuánto
 * gastó en el rango que elija y en qué —respuestas, llamadas, voz— con el
 * detalle línea por línea abajo.
 *
 * El desglose por concepto está arriba del detalle a propósito: la pregunta que
 * trae a alguien a esta pantalla es "¿en qué se me va la plata?", y esa la
 * contesta el resumen. La lista es el respaldo para el que no le cree al
 * resumen, que es exactamente para lo que tiene que estar.
 */

interface Tarifa {
  concepto: string;
  nombreEs: string;
  nombreEn: string;
  unidad: string;
  precioMilicentavos: number;
}

interface Estado {
  saldoCentavos: number;
  moneda: string;
  bloquearSinSaldo: boolean;
  /** Cuenta de cortesía: no gasta saldo y nunca se le apaga la IA. */
  exenta: boolean;
  /** Se le descuenta el costo real, sin margen. */
  aCosto: boolean;
  costos: {
    concepto: string;
    nombreEs: string;
    nombreEn: string;
    centavos: number;
    unidad: string;
    proveedor: string;
    medido: boolean;
    cobro: 'por_uso' | 'incluido' | 'sin_cargo';
    dentroDeEs?: string;
    dentroDeEn?: string;
  }[];
  resumen: {
    rango: { desde: string; hasta: string };
    cargadoCentavos: number;
    gastadoCentavos: number;
    movimientos: number;
    porConcepto: {
      concepto: string;
      centavos: number;
      cantidad: number;
      movimientos: number;
      porUnidadCentavos: number | null;
    }[];
    porDia: { dia: string; gastadoCentavos: number; cargadoCentavos: number }[];
  };
  tarifas: Tarifa[];
  puedeRecargar: boolean;
  sugeridos: number[];
  auto: {
    tieneTarjeta: boolean;
    recargaCentavos: number | null;
    umbralCentavos: number | null;
    fallos: number;
    ultimoError: string | null;
  };
}

interface Movimiento {
  id: string;
  creadoEn: string;
  tipo: string;
  concepto: string;
  centavos: number;
  saldoDespuesCentavos: number;
  cantidad: number | null;
  unidad: string | null;
  referenciaTipo: string | null;
  referenciaId: string | null;
}

/** 0 = hoy, -1 = ayer. Los positivos son ventanas móviles hacia atrás. */
const DIAS = [0, -1, 7, 30, 90] as const;

function desdeHace(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

/** Medianoche de hoy, o de hace `offset` días. En la hora del navegador: el
 *  comercio piensa "hoy" en su reloj, no en UTC. */
function inicioDelDia(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}

/** Sólo la parte YYYY-MM-DD, que es lo que entiende un <input type=date>. */
const soloDia = (iso: string) => iso.slice(0, 10);

export function WalletPanel() {
  const t = useT();
  const { locale } = useLocale();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();

  const [dias, setDias] = useState<number | null>(30);
  const [desde, setDesde] = useState<string>(soloDia(desdeHace(30)));
  const [hasta, setHasta] = useState<string>(soloDia(new Date().toISOString()));
  const [e, setE] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [yendo, setYendo] = useState(false);
  const [otro, setOtro] = useState('');
  const [concepto, setConcepto] = useState<string | null>(null);
  const [movs, setMovs] = useState<Movimiento[] | null>(null);
  const [pagina, setPagina] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [autoMonto, setAutoMonto] = useState("");
  const [autoUmbral, setAutoUmbral] = useState("");

  const rango = useMemo(() => {
    // Hoy y ayer son DÍAS, no ventanas de 24 horas: "hoy" arranca a la
    // medianoche. Un resumen que dice "hoy" y trae lo de anoche hace dudar de
    // todos los demás números de la pantalla.
    if (dias === 0) {
      return { desde: inicioDelDia(0), hasta: new Date().toISOString() };
    }
    if (dias === -1) {
      return { desde: inicioDelDia(-1), hasta: inicioDelDia(0) };
    }
    if (dias !== null) {
      return { desde: desdeHace(dias), hasta: new Date().toISOString() };
    }
    return {
      desde: new Date(`${desde}T00:00:00`).toISOString(),
      // El día "hasta" se toma entero: quien elige el 20 quiere lo del 20.
      hasta: new Date(`${hasta}T23:59:59`).toISOString(),
    };
  }, [dias, desde, hasta]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      setCargando(true);
      try {
        const q = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
        const res = await fetch(`/api/wallet/estado?${q}`, { cache: 'no-store' });
        if (vivo) setE(res.ok ? ((await res.json()) as Estado) : null);
        // El número del menú viene de otra lectura: al volver de Stripe esta
        // pantalla ya muestra el saldo nuevo y el menú seguiría con el viejo.
        if (vivo && res.ok) avisarSaldoCambio();
      } catch {
        if (vivo) setE(null);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [rango.desde, rango.hasta]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const q = new URLSearchParams({
          desde: rango.desde,
          hasta: rango.hasta,
          pagina: String(pagina),
        });
        if (concepto) q.set('concepto', concepto);
        const res = await fetch(`/api/wallet/movimientos?${q}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { filas: Movimiento[]; hayMas: boolean };
        if (!vivo) return;
        setMovs(json.filas);
        setHayMas(json.hayMas);
      } catch {
        if (vivo) setMovs([]);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [rango.desde, rango.hasta, concepto, pagina]);

  const recargar = useCallback(
    async (centavos: number) => {
      setYendo(true);
      try {
        const res = await fetchWithCsrf('/api/wallet/recargar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ centavos }),
        });
        const json = (await res.json()) as { url?: string; error?: string };
        if (json.url) window.location.href = json.url;
        // El error del servidor, tal cual: dice el mínimo y el máximo. El texto
        // genérico dejaba a la persona probando montos a ciegas.
        else toast.error(json.error ?? t('settings.walletTopUpFailed'));
      } catch {
        toast.error(t('settings.walletTopUpFailed'));
      } finally {
        setYendo(false);
      }
    },
    [fetchWithCsrf, t],
  );

  /** Guardar la tarjeta, o cambiarla. No cobra nada: es una autorización. */
  const irPorTarjeta = useCallback(async () => {
    setYendo(true);
    try {
      const res = await fetchWithCsrf('/api/wallet/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarjeta: true }),
      });
      const json = (await res.json()) as { url?: string };
      if (json.url) window.location.href = json.url;
      else toast.error(t('settings.walletTopUpFailed'));
    } catch {
      toast.error(t('settings.walletTopUpFailed'));
    } finally {
      setYendo(false);
    }
  }, [fetchWithCsrf, t]);

  const guardarAuto = useCallback(
    async (cuerpo: Record<string, unknown>) => {
      setYendo(true);
      try {
        const res = await fetchWithCsrf('/api/wallet/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!json.ok) {
          toast.error(json.error ?? t('settings.walletTopUpFailed'));
          return;
        }
        toast.success(t('settings.walletAutoSaved'));
        const q = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
        const nuevo = await fetch(`/api/wallet/estado?${q}`, { cache: 'no-store' });
        if (nuevo.ok) setE((await nuevo.json()) as Estado);
      } catch {
        toast.error(t('settings.walletTopUpFailed'));
      } finally {
        setYendo(false);
      }
    },
    [fetchWithCsrf, rango.desde, rango.hasta, t],
  );

  const plata = useCallback(
    (centavos: number) => fmt.currency(centavos / 100, (e?.moneda ?? 'usd').toUpperCase()),
    [fmt, e?.moneda],
  );

  const nombreConcepto = useCallback(
    (c: string) => {
      if (c === 'recarga') return t('settings.walletTopUp');
      const tar = e?.tarifas.find((x) => x.concepto === c);
      if (!tar) return c;
      return locale === 'en' ? tar.nombreEn : tar.nombreEs;
    },
    [e?.tarifas, locale, t],
  );

  if (cargando && !e) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!e) return null;

  const { resumen, auto } = e;
  const maxDia = Math.max(1, ...resumen.porDia.map((d) => d.gastadoCentavos));
  const enRojo = e.saldoCentavos <= 0 && !e.exenta;

  return (
    <div className="space-y-6">
      {/* ── Saldo y recarga ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="size-4" />
              {t('settings.walletBalance')}
            </p>
            <p
              className={cn(
                'mt-1 text-3xl font-semibold tabular-nums',
                enRojo ? 'text-destructive' : 'text-foreground',
              )}
            >
              {plata(e.saldoCentavos)}
            </p>
          </div>
          {e.puedeRecargar && (
            <div className="flex flex-wrap items-center gap-2">
              {e.sugeridos.map((c) => (
                <Button
                  key={c}
                  variant="outline"
                  size="sm"
                  disabled={yendo}
                  onClick={() => void recargar(c)}
                >
                  {plata(c)}
                </Button>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  value={otro}
                  onChange={(ev) => setOtro(ev.target.value.replace(/[^\d]/g, ''))}
                  placeholder={t('settings.walletOther')}
                  title={t('settings.walletMin')}
                  inputMode="numeric"
                  className="h-9 w-24"
                />
                <Button
                  size="sm"
                  disabled={yendo || !otro}
                  onClick={() => void recargar(Number(otro) * 100)}
                >
                  {yendo ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
        {enRojo && (
          <p className="mt-3 text-sm text-muted-foreground">
            {e.bloquearSinSaldo
              ? t('settings.walletEmptyBlocking')
              : t('settings.walletEmpty')}
          </p>
        )}
      </section>

      {/* ── Recarga automática ──────────────────────────────────────── */}
      {e.puedeRecargar && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('settings.walletAutoTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {auto.recargaCentavos !== null && auto.umbralCentavos !== null
                  ? t('settings.walletAutoOn', {
                      monto: plata(auto.recargaCentavos),
                      umbral: plata(auto.umbralCentavos),
                    })
                  : t('settings.walletAutoOff')}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={yendo} onClick={() => void irPorTarjeta()}>
              <CreditCard className="size-4" />
              {auto.tieneTarjeta
                ? t('settings.walletCardChange')
                : t('settings.walletCardAdd')}
            </Button>
          </div>

          {/* Sin tarjeta guardada no se ofrece configurar el disparo: sería
              prometer un cobro que no se puede hacer. */}
          {auto.tieneTarjeta && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-muted-foreground">
                  {t('settings.walletAutoAmount')}
                </span>
                <Input
                  value={autoMonto}
                  onChange={(ev) => setAutoMonto(ev.target.value.replace(/[^\d]/g, ''))}
                  placeholder={
                    auto.recargaCentavos !== null
                      ? String(auto.recargaCentavos / 100)
                      : '50'
                  }
                  inputMode="numeric"
                  className="mt-1 h-9 w-28"
                />
              </label>
              <label className="text-sm">
                <span className="block text-muted-foreground">
                  {t('settings.walletAutoThreshold')}
                </span>
                <Input
                  value={autoUmbral}
                  onChange={(ev) => setAutoUmbral(ev.target.value.replace(/[^\d]/g, ''))}
                  placeholder={
                    auto.umbralCentavos !== null
                      ? String(auto.umbralCentavos / 100)
                      : '10'
                  }
                  inputMode="numeric"
                  className="mt-1 h-9 w-28"
                />
              </label>
              <Button
                size="sm"
                disabled={yendo || (!autoMonto && !autoUmbral)}
                onClick={() =>
                  void guardarAuto({
                    recargaCentavos:
                      (Number(autoMonto) || (auto.recargaCentavos ?? 0) / 100) * 100,
                    umbralCentavos:
                      (Number(autoUmbral) || (auto.umbralCentavos ?? 0) / 100) * 100,
                  })
                }
              >
                {t('settings.walletAutoSave')}
              </Button>
              {auto.recargaCentavos !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={yendo}
                  onClick={() => void guardarAuto({ apagar: true })}
                >
                  {t('settings.walletAutoTurnOff')}
                </Button>
              )}
            </div>
          )}

          {/* El error del banco, tal cual. "No se pudo cobrar" no le sirve a
              nadie: fondos insuficientes y tarjeta vencida se arreglan distinto. */}
          {auto.fallos > 0 && (
            <p className="mt-3 text-sm text-destructive">
              {auto.fallos >= 3
                ? t('settings.walletAutoGaveUp')
                : t('settings.walletAutoFailed')}
              {auto.ultimoError ? ` — ${auto.ultimoError}` : ''}
            </p>
          )}
        </section>
      )}

      {/* ── Rango ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {DIAS.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={dias === d ? 'default' : 'outline'}
            onClick={() => {
              setDias(d);
              setPagina(0);
            }}
          >
            {d === 0
              ? t('settings.walletToday')
              : d === -1
                ? t('settings.walletYesterday')
                : t('settings.walletLastDays', { n: d })}
          </Button>
        ))}
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={desde}
            onChange={(ev) => {
              setDesde(ev.target.value);
              setDias(null);
              setPagina(0);
            }}
            className="h-9 w-40"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            value={hasta}
            onChange={(ev) => {
              setHasta(ev.target.value);
              setDias(null);
              setPagina(0);
            }}
            className="h-9 w-40"
          />
        </div>
      </div>

      {/* ── Entró / salió ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('settings.walletSpent')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {plata(resumen.gastadoCentavos)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('settings.walletLoaded')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {plata(resumen.cargadoCentavos)}
          </p>
        </div>
      </div>

      {/* ── Gasto por día ───────────────────────────────────────────── */}
      {resumen.porDia.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {t('settings.walletByDay')}
          </h3>
          <div className="mt-4 flex h-28 items-end gap-1">
            {resumen.porDia.map((d) => (
              <div
                key={d.dia}
                className="group relative flex-1"
                title={`${fmt.date(d.dia)} · ${plata(d.gastadoCentavos)}`}
              >
                <div
                  className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                  style={{
                    height: `${Math.max(2, (d.gastadoCentavos / maxDia) * 100)}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{fmt.date(resumen.porDia[0].dia)}</span>
            <span>{fmt.date(resumen.porDia[resumen.porDia.length - 1].dia)}</span>
          </div>
        </section>
      )}

      {/* ── En qué se fue ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">
          {t('settings.walletByConcept')}
        </h3>
        {resumen.porConcepto.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('settings.walletNoSpend')}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {resumen.porConcepto.map((c) => {
              const pct = Math.round((c.centavos / Math.max(1, resumen.gastadoCentavos)) * 100);
              const activo = concepto === c.concepto;
              return (
                <li key={c.concepto}>
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      setConcepto(activo ? null : c.concepto);
                      setPagina(0);
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span
                        className={cn(
                          'truncate',
                          activo ? 'font-medium text-foreground' : 'text-foreground',
                        )}
                      >
                        {nombreConcepto(c.concepto)}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {plata(c.centavos)} · {pct}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── El detalle ──────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t('settings.walletLedger')}
          </h3>
          {concepto && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConcepto(null);
                setPagina(0);
              }}
            >
              {t('settings.walletClearFilter')}
            </Button>
          )}
        </header>

        {!movs ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : movs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            {t('settings.walletNoMovements')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {movs.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-foreground">{nombreConcepto(m.concepto)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmt.dateTime(m.creadoEn)}
                    {m.cantidad !== null && m.unidad
                      ? ` · ${fmt.number(m.cantidad)} ${m.unidad}`
                      : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      'tabular-nums',
                      m.centavos >= 0 ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {m.centavos >= 0 ? '+' : '−'}
                    {plata(Math.abs(m.centavos))}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {plata(m.saldoDespuesCentavos)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {(pagina > 0 || hayMas) && (
          <footer className="flex items-center justify-between border-t border-border px-5 py-3">
            <Button
              size="sm"
              variant="outline"
              disabled={pagina === 0}
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
            >
              {t('settings.walletPrev')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hayMas}
              onClick={() => setPagina((p) => p + 1)}
            >
              {t('settings.walletNext')}
            </Button>
          </footer>
        )}
      </section>

      {/* ── Cuánto sale cada cosa ───────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">
          {t('settings.walletRates')}
        </h3>
        {/* Con el costo pasado sin margen, la lista de abajo deja de ser lo que
            se cobra. Decirlo es lo único honesto: si no, el primer resumen que
            no coincida con esta tabla parece un error de facturación. */}
        {e.aCosto && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('settings.walletAtCostNote')}
          </p>
        )}
        <ul className="mt-3 space-y-2 text-sm">
          {e.costos.map((c) => {
            // Tres números posibles, y se elige el más cierto que haya:
            //   1. lo que ya se le cobró por unidad en este rango,
            //   2. lo que le sale de verdad según SU consumo,
            //   3. la tarifa de lista, marcada como estimado.
            const tar = e.tarifas.find((x) => x.concepto === c.concepto);
            const cobrado = resumen.porConcepto.find(
              (x) => x.concepto === c.concepto,
            )?.porUnidadCentavos;
            const centavos =
              cobrado ??
              (e.aCosto || !tar ? c.centavos : tar.precioMilicentavos / 1000);
            const esMedido =
              cobrado !== null && cobrado !== undefined ? true : c.medido;
            const dentroDe = locale === 'en' ? c.dentroDeEn : c.dentroDeEs;
            return (
              <li key={c.concepto} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-foreground">
                    {locale === 'en' ? c.nombreEn : c.nombreEs}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {c.proveedor}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-foreground">
                  {c.cobro === 'por_uso' ? (
                    <>
                      {fmt.currency(centavos / 100, (e.moneda ?? 'usd').toUpperCase(), {
                        maximumFractionDigits: 4,
                      })}{' '}
                      / {c.unidad}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {c.cobro === 'sin_cargo'
                        ? t('settings.walletNoCharge')
                        : t('settings.walletInsideOf', { linea: dentroDe ?? '' })}
                    </span>
                  )}
                  {c.cobro === 'por_uso' && (
                    <span className="block text-xs text-muted-foreground">
                      {esMedido
                        ? t('settings.walletYourAverage')
                        : t('settings.walletEstimate')}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('settings.walletIncluded')}
        </p>
      </section>
    </div>
  );
}
