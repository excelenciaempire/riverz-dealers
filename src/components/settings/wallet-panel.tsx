'use client';

import { LogoTarjeta } from '@/components/billing/logo-tarjeta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFormat } from '@/hooks/use-format';
import { useLocale, useT } from '@/hooks/use-locale';
import { avisarSaldoCambio } from '@/hooks/use-saldo';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { cn } from '@/lib/utils';
import {movementContext,movementTokens} from '@/lib/wallet/movement-context';
import {useTimezone} from '@/hooks/use-timezone';
import {daysAgoStart} from '@/lib/dashboard/date-utils';
import {fromZonedTime} from 'date-fns-tz';
import type { BilledActivity } from '@/lib/wallet/activity';
import { ChevronDown, CreditCard, Loader2, Plus, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

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
  billedActivity?: BilledActivity;
  reservadoCentavos?: number;
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
    ajustesCentavos: number;
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
    marca: string | null;
    ultimos4: string | null;
    recargaCentavos: number | null;
    umbralCentavos: number | null;
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
  detalle?: Record<string,unknown>;
}

/** 0 = hoy, -1 = ayer. Los positivos son ventanas móviles hacia atrás. */
const DIAS = [0, -1, 7, 30, 90] as const;

function desdeHace(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
}

/** Medianoche de hoy, o de hace `offset` días. En la hora del navegador: el
 *  comercio piensa "hoy" en su reloj, no en UTC. */

/** Sólo la parte YYYY-MM-DD, que es lo que entiende un <input type=date>. */
const soloDia = (iso: string) => iso.slice(0, 10);

export function WalletPanel() {
  const t = useT();
  const { locale } = useLocale();
  const fmt = useFormat();
  const tz=useTimezone();
  const channelName=(channel:string)=>channel==='fb_comment'?t('settings.walletActivityFbComments'):
    channel==='ig_comment'?t('settings.walletActivityIgComments'):channel==='webchat'?t('settings.walletActivityWeb'):
    ({whatsapp:'WhatsApp',gmail:'Gmail',outlook:'Outlook / Hotmail',zoho:'Zoho',instagram:'Instagram',messenger:'Messenger',mercadolibre:'Mercado Libre',telegram:'Telegram',sms:'SMS',tiktok:'TikTok'} as Record<string,string>)[channel]??t('settings.walletActivityOther');
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
  const [movimientosAbiertos, setMovimientosAbiertos] = useState(true);
  const [autoDeseado, setAutoDeseado] = useState<boolean | null>(null);
  const [autoMonto, setAutoMonto] = useState('');
  const [autoUmbral, setAutoUmbral] = useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')setRevision(v=>v+1);};
    const interval=setInterval(refresh,30_000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(interval);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);

  const rango = useMemo(() => {
    // Refresh the current range as live usage arrives, including across midnight.
    void revision;
    // Hoy y ayer son DÍAS, no ventanas de 24 horas: "hoy" arranca a la
    // medianoche. Un resumen que dice "hoy" y trae lo de anoche hace dudar de
    // todos los demás números de la pantalla.
    if (dias === 0) {
      return { desde: daysAgoStart(tz,0).toISOString(), hasta: new Date().toISOString() };
    }
    if (dias === -1) {
      return { desde: daysAgoStart(tz,1).toISOString(), hasta: daysAgoStart(tz,0).toISOString() };
    }
    if (dias !== null) {
      return { desde: desdeHace(dias), hasta: new Date().toISOString() };
    }
    return {
      desde: fromZonedTime(`${desde}T00:00:00`,tz).toISOString(),
      // El día "hasta" se toma entero: quien elige el 20 quiere lo del 20.
      hasta: fromZonedTime(`${hasta}T23:59:59`,tz).toISOString(),
    };
  }, [dias, desde, hasta, revision, tz]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      setCargando(true);
      try {
        const q = new URLSearchParams({
          desde: rango.desde,
          hasta: rango.hasta,
        });
        const res = await fetch(`/api/wallet/estado?${q}`, {
          cache: 'no-store',
        });
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
  }, [rango.desde, rango.hasta, revision]);

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
        const res = await fetch(`/api/wallet/movimientos?${q}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          filas: Movimiento[];
          hayMas: boolean;
        };
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
  }, [rango.desde, rango.hasta, concepto, pagina, revision]);

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
    [fetchWithCsrf, t]
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
        const q = new URLSearchParams({
          desde: rango.desde,
          hasta: rango.hasta,
        });
        const nuevo = await fetch(`/api/wallet/estado?${q}`, {
          cache: 'no-store',
        });
        if (nuevo.ok) setE((await nuevo.json()) as Estado);
      } catch {
        toast.error(t('settings.walletTopUpFailed'));
      } finally {
        setYendo(false);
      }
    },
    [fetchWithCsrf, rango.desde, rango.hasta, t]
  );

  /**
   * Los centavos que hagan falta y ni uno más: «10 US$», «3,16 US$».
   *
   * Casi toda la plata de la billetera es redonda —las recargas, el umbral, los
   * botones— y el «,00» de cada una es ruido que le roba peso a la cifra. Los
   * centavos que SÍ dicen algo (un gasto de 3,16) siguen apareciendo.
   */
  const plata = useCallback(
    (centavos: number) =>
      fmt.currency(centavos / 100, (e?.moneda ?? 'usd').toUpperCase(), {
        // Entero: sin decimales. Con centavos: los dos, nunca uno —«0,1 US$»
        // se lee como un número roto, no como diez centavos.
        minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
      }),
    [fmt, e?.moneda]
  );

  const nombreConcepto = useCallback(
    (c: string) => {
      if (c === 'recarga_ajuste') return t('settings.walletTopupAdjustment');
      if (c === 'comision_stripe') return t('settings.walletTopupAdjustment');
      if (c === 'recarga') return t('settings.walletTopUp');
      const tar = e?.tarifas.find((x) => x.concepto === c);
      if (!tar) return c;
      return locale === 'en' ? tar.nombreEn : tar.nombreEs;
    },
    [e?.tarifas, locale, t]
  );

  if (cargando && !e) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }
  if (!e) return null;
  if (e.exenta) return null;

  const { resumen, auto } = e;
  const autoActivo =
    auto.recargaCentavos !== null && auto.umbralCentavos !== null;
  const autoVisible = autoDeseado ?? autoActivo;
  const maxDia = Math.max(1, ...resumen.porDia.map((d) => d.gastadoCentavos));
  const enRojo = e.saldoCentavos <= 0 && !e.exenta;

  return (
    <div className="space-y-6">
      {/* ── Saldo y recarga ─────────────────────────────────────────── */}
      <section className="border-border bg-card rounded-xl border p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Wallet className="size-4" />
              {t('settings.walletBalance')}
            </p>
            <p
              className={cn(
                'mt-1 text-3xl font-semibold tabular-nums',
                enRojo ? 'text-destructive' : 'text-foreground'
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
                  {/* Sin decimales: son montos redondos y el ",00" de cada uno
                      sólo alarga cuatro botones que se leen de un vistazo. */}
                  {fmt.currency(c / 100, (e.moneda ?? 'usd').toUpperCase(), {
                    maximumFractionDigits: 0,
                  })}
                </Button>
              ))}
              <div className="flex items-center gap-1">
                {/* El signo adentro del campo: sin él, «10» al lado de botones
                    que dicen «10,00 US$» se lee como otra cosa. */}
                <div className="relative">
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
                    $
                  </span>
                  <Input
                    value={otro}
                    onChange={(ev) =>
                      setOtro(ev.target.value.replace(/[^\d]/g, ''))
                    }
                    placeholder={t('settings.walletOther')}
                    title={t('settings.walletMin')}
                    inputMode="numeric"
                    className="h-9 w-24 pl-6"
                  />
                </div>
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
        {(e.reservadoCentavos ?? 0) > 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {t('settings.walletReserved', {
              amount: plata(e.reservadoCentavos ?? 0),
            })}
          </p>
        )}
        {enRojo && (
          <p className="text-muted-foreground mt-3 text-sm">
            {e.bloquearSinSaldo
              ? t('settings.walletEmptyBlocking')
              : t('settings.walletEmpty')}
          </p>
        )}
      </section>

      {/* ── Recarga automática ──────────────────────────────────────── */}
      {e.puedeRecargar && (
        <section className="border-border bg-card rounded-xl border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-foreground text-sm font-semibold">
                  {t('settings.walletAutoTitle')}
                </h3>
                <Switch
                  checked={autoVisible}
                  disabled={yendo}
                  aria-label={t('settings.walletAutoTitle')}
                  onCheckedChange={(checked) => {
                    setAutoDeseado(checked);
                    if (checked) {
                      if (!auto.tieneTarjeta) return;
                      void guardarAuto({
                        recargaCentavos: (Number(autoMonto) || 10) * 100,
                        umbralCentavos: (Number(autoUmbral) || 1) * 100,
                      }).finally(() => setAutoDeseado(null));
                      return;
                    }
                    if (!autoActivo) {
                      setAutoDeseado(null);
                      return;
                    }
                    setAutoMonto(String((auto.recargaCentavos ?? 1000) / 100));
                    setAutoUmbral(String((auto.umbralCentavos ?? 100) / 100));
                    void guardarAuto({ apagar: true }).finally(() =>
                      setAutoDeseado(null)
                    );
                  }}
                />
              </div>
            </div>
            {autoVisible && (
              <div className="flex items-center gap-3">
                {/* Cuál tarjeta quedó. "Hay una tarjeta" no le sirve a quien
                  tiene tres: sin la marca y los últimos cuatro, ante la duda la
                  cambia — o no la cambia porque no sabe si hace falta. */}
                {auto.tieneTarjeta && auto.ultimos4 && (
                  <span className="text-foreground flex items-center gap-2 text-sm">
                    <LogoTarjeta marca={auto.marca} />
                    <span className="tabular-nums">···· {auto.ultimos4}</span>
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={yendo}
                  onClick={() => void irPorTarjeta()}
                >
                  <CreditCard className="size-4" />
                  {auto.tieneTarjeta
                    ? t('settings.walletCardChange')
                    : t('settings.walletCardAdd')}
                </Button>
                {auto.tieneTarjeta && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={yendo}
                    onClick={() => {
                      if (confirm(t('settings.walletCardRemoveConfirm'))) {
                        void guardarAuto({ borrarTarjeta: true });
                      }
                    }}
                  >
                    {t('settings.walletCardRemove')}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Sin tarjeta guardada no se ofrece configurar el disparo: sería
              prometer un cobro que no se puede hacer. */}
          {autoVisible && auto.tieneTarjeta && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="text-muted-foreground block">
                  {t('settings.walletAutoAmount')}
                </span>
                <Input
                  value={autoMonto}
                  onChange={(ev) =>
                    setAutoMonto(ev.target.value.replace(/[^\d]/g, ''))
                  }
                  placeholder={
                    auto.recargaCentavos !== null
                      ? String(auto.recargaCentavos / 100)
                      : '10'
                  }
                  inputMode="numeric"
                  className="mt-1 h-9 w-28"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground block">
                  {t('settings.walletAutoThreshold')}
                </span>
                <Input
                  value={autoUmbral}
                  onChange={(ev) =>
                    setAutoUmbral(ev.target.value.replace(/[^\d]/g, ''))
                  }
                  placeholder={
                    auto.umbralCentavos !== null
                      ? String(auto.umbralCentavos / 100)
                      : '1'
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
                      (Number(autoMonto) || (auto.recargaCentavos ?? 0) / 100) *
                      100,
                    umbralCentavos:
                      (Number(autoUmbral) || (auto.umbralCentavos ?? 0) / 100) *
                      100,
                  })
                }
              >
                {t('settings.walletAutoSave')}
              </Button>
            </div>
          )}
          {autoVisible && autoActivo && (
            <p className="text-muted-foreground mt-3 text-sm">
              {t('settings.walletAutoOn', {
                monto: plata(auto.recargaCentavos ?? 0),
                umbral: plata(auto.umbralCentavos ?? 0),
              })}
            </p>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* ── Uso en el período ───────────────────────────────────────── */}
        <section className="border-border bg-card rounded-xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-foreground text-sm font-semibold">
              {t('settings.walletUsage')}
            </h3>
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
              <Button
                size="sm"
                variant={dias === null ? 'default' : 'outline'}
                onClick={() => {
                  setDias(null);
                  setPagina(0);
                }}
              >
                {t('settings.walletCustomRange')}
              </Button>
            </div>
          </div>

          {dias === null && (
            <div className="mt-3 flex w-full items-center gap-2 sm:w-auto">
              <Input
                type="date"
                value={desde}
                onChange={(ev) => {
                  setDesde(ev.target.value);
                  setPagina(0);
                }}
                className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={hasta}
                onChange={(ev) => {
                  setHasta(ev.target.value);
                  setPagina(0);
                }}
                className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none"
              />
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="bg-muted rounded-lg p-4">
              <p className="text-muted-foreground text-sm">
                {t('settings.walletSpent')}
              </p>
              <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                {plata(resumen.gastadoCentavos)}
              </p>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <p className="text-muted-foreground text-sm">
                {t('settings.walletLoaded')}
              </p>
              <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                {plata(resumen.cargadoCentavos)}
              </p>
            </div>
          </div>
          {!!resumen.ajustesCentavos&&<p className="mt-2 text-xs text-muted-foreground">{t('settings.walletAdjustments')}: {plata(resumen.ajustesCentavos)}</p>}

          {resumen.porDia.length > 1 && (
            <div className="mt-6">
              <h4 className="text-foreground text-sm font-medium">
                {t('settings.walletByDay')}
              </h4>
              <div className="mt-3 flex h-28 items-end gap-1">
                {resumen.porDia.map((d) => (
                  <div
                    key={d.dia}
                    className="group relative flex h-full flex-1 items-end"
                    title={`${fmt.date(d.dia,{timeZone:'UTC'})} · ${plata(d.gastadoCentavos)}`}
                  >
                    <div
                      className="bg-primary w-full rounded-t transition-colors"
                      style={{
                        height: `${Math.max(2, (d.gastadoCentavos / maxDia) * 100)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="text-muted-foreground mt-2 flex justify-between text-xs">
                <span>{fmt.date(resumen.porDia[0].dia,{timeZone:'UTC'})}</span>
                <span>
                  {fmt.date(resumen.porDia[resumen.porDia.length - 1].dia,{timeZone:'UTC'})}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* ── En qué se fue ───────────────────────────────────────────── */}
        <section className="border-border bg-card rounded-xl border p-5">
          <h3 className="text-foreground text-sm font-semibold">
            {t('settings.walletByConcept')}
          </h3>
          {resumen.porConcepto.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {t('settings.walletNoSpend')}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {resumen.porConcepto.map((c) => {
                const pct = Math.round(
                  (c.centavos / Math.max(1, resumen.gastadoCentavos)) * 100
                );
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
                            activo
                              ? 'text-foreground font-medium'
                              : 'text-foreground'
                          )}
                        >
                          {nombreConcepto(c.concepto)}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {plata(c.centavos)} · {pct}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{t('settings.walletChargedOperations',{count:c.movimientos})}</p>
                      <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full rounded-full"
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
      </div>

      {/* ── El detalle ──────────────────────────────────────────────── */}
      {e.billedActivity&&<section className="border-border bg-card rounded-xl border p-5">
        <h3 className="text-sm font-semibold">{t('settings.walletActivity')}</h3>
        <p className="text-muted-foreground mt-1 text-xs">{t('settings.walletActivityNote')}</p>
        <div className="overflow-x-auto mt-4"><table className="w-full text-sm">
          <thead className="text-muted-foreground"><tr><th className="text-left py-2">{t('settings.walletActivityChannel')}</th>
            <th className="text-right px-3">{t('settings.walletActivityContacts')}</th><th className="text-right px-3">{t('settings.walletActivityCharges')}</th><th className="text-right">{t('settings.walletActivityCharged')}</th></tr></thead>
          <tbody>{e.billedActivity.byChannel.map(c=><tr key={c.channel} className="border-t border-border"><td className="py-3">{channelName(c.channel)}</td>
            <td className="text-right px-3 tabular-nums">{fmt.number(c.contacts)}</td><td className="text-right px-3 tabular-nums">{fmt.number(c.charges)}</td><td className="text-right tabular-nums">{fmt.currency(c.chargedCentavos / 100, e.moneda.toUpperCase())}</td></tr>)}</tbody>
          <tfoot className="font-semibold border-t border-border"><tr><td className="py-3">{t('settings.walletActivityTotal')}</td><td className="text-right px-3">{fmt.number(e.billedActivity.contacts)}</td><td className="text-right px-3">{fmt.number(e.billedActivity.charges)}</td><td className="text-right">{fmt.currency(e.billedActivity.chargedCentavos / 100, e.moneda.toUpperCase())}</td></tr></tfoot>
        </table></div>
      </section>}
      <details
        className="group border-border bg-card rounded-xl border"
        open={movimientosAbiertos}
        onToggle={(ev) => setMovimientosAbiertos(ev.currentTarget.open)}
      >
        <summary className="group-open:border-border flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 group-open:border-b">
          <span className="text-foreground text-sm font-semibold">
            {t('settings.walletLedger')}
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>

        {concepto && (
          <div className="border-border flex justify-end border-b px-4 py-2">
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
          </div>
        )}

        {!movs ? (
          <div className="flex justify-center py-8">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : movs.length === 0 ? (
          <p className="text-muted-foreground px-5 py-8 text-center text-sm">
            {t('settings.walletNoMovements')}
          </p>
        ) : (
          <ul
            className="divide-border scrollbar-thin divide-y overflow-y-auto"
            style={{ maxHeight: '32rem' }}
          >
            {movs.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-foreground truncate">
                    {nombreConcepto(m.concepto)}
                  </p>
                  {movementContext(m.detalle,t)&&<p className="text-xs text-muted-foreground">{movementContext(m.detalle,t)}</p>}
                  {movementTokens(m.detalle)!==null&&<p className="text-xs text-muted-foreground">{t('settings.walletProcessedTokens',{n:fmt.number(movementTokens(m.detalle)!)})}</p>}
                  <p className="text-muted-foreground text-xs">
                    {fmt.dateTime(m.creadoEn)}
                    {` · #${m.id.slice(0,8)}`}
                    {m.cantidad !== null && m.unidad
                      ? ` · ${fmt.number(m.cantidad)} ${m.unidad}`
                      : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      'tabular-nums',
                      m.centavos >= 0 ? 'text-primary' : 'text-foreground'
                    )}
                  >
                    {m.centavos >= 0 ? '+' : '−'}
                    {plata(Math.abs(m.centavos))}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {t('settings.walletBalanceAfter', {
                      saldo: plata(m.saldoDespuesCentavos),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {(pagina > 0 || hayMas) && (
          <footer className="border-border flex items-center justify-between border-t px-5 py-3">
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
      </details>

      {/* ── Cuánto sale cada cosa ───────────────────────────────────── */}
      <details className="group border-border bg-card rounded-xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span>
            <span className="text-foreground block text-sm font-semibold">
              {t('settings.walletRates')}
            </span>
            {e.aCosto && (
              <span className="text-muted-foreground mt-1 block text-sm">
                {t('settings.walletAtCostNote')}
              </span>
            )}
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        {/* Con el costo pasado sin margen, la lista de abajo deja de ser lo que
            se cobra. Decirlo es lo único honesto: si no, el primer resumen que
            no coincida con esta tabla parece un error de facturación. */}
        <ul className="border-border space-y-3 border-t px-5 py-4 text-sm">
          {e.costos.map((c) => {
            // Tres números posibles, y se elige el más cierto que haya:
            //   1. lo que ya se le cobró por unidad en este rango,
            //   2. lo que le sale de verdad según SU consumo,
            //   3. la tarifa de lista, marcada como estimado.
            const tar = e.tarifas.find((x) => x.concepto === c.concepto);
            const cobrado = resumen.porConcepto.find(
              (x) => x.concepto === c.concepto
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
                  <span className="text-muted-foreground block text-xs">
                    {c.proveedor}
                  </span>
                </span>
                <span className="text-foreground shrink-0 text-right tabular-nums">
                  {!esMedido && c.centavos === 0 ? (
                    t('settings.walletActualUsageRate')
                  ) : c.cobro === 'por_uso' ? (
                    <>
                      {fmt.currency(
                        centavos / 100,
                        (e.moneda ?? 'usd').toUpperCase(),
                        {
                          maximumFractionDigits: 4,
                        }
                      )}{' '}
                      / {c.unidad}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {c.cobro === 'sin_cargo'
                        ? t('settings.walletNoCharge')
                        : t('settings.walletInsideOf', {
                            linea: dentroDe ?? '',
                          })}
                    </span>
                  )}
                  {c.cobro === 'por_uso' &&
                    c.concepto !== 'comision_stripe' && (
                      <span className="text-muted-foreground block text-xs">
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
      </details>
    </div>
  );
}
