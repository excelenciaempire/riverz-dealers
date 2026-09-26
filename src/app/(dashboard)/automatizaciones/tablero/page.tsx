'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Loader2, Pencil, Reply } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useLocale, useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ai/chat-de-prueba';
import type { AutomacionSimulada, PasoSimulado } from '@/lib/automations/simulacion';
import { cn } from '@/lib/utils';

/**
 * El tablero de mensajes: todo lo que recibe un cliente, situación por
 * situación, para mostrárselo al dueño de la marca en una reunión y dejar
 * escritos ahí mismo los textos que quiere. Lo arma el mismo simulador de
 * "Probar como cliente" (`/api/automations/tablero`), así que lo que se ve es
 * lo que se envía.
 */

interface Columna {
  id: string;
  escenario: string;
  pago: string | null;
  oferta: string | null;
  automatizaciones: AutomacionSimulada[];
}

interface Plantilla {
  id: string;
  name: string;
  status: string | null;
  category: string | null;
  body_text: string | null;
  variable_fields: Record<string, string> | null;
}

const TITULO: Record<string, string> = {
  pagado: 'automations.tableroPagado',
  contraentrega: 'automations.tableroContraentrega',
  transferencia: 'automations.tableroTransferencia',
  pendiente: 'automations.tableroPendiente',
  carrito: 'automations.tableroCarrito',
  rechazado: 'automations.tableroRechazado',
  despachado: 'automations.tableroDespachado',
  entregado: 'automations.tableroEntregado',
  cancelado: 'automations.tableroCancelado',
};

/** Cómo se lee cada variable de las plantillas, en la vista "con variables". */
const NOMBRE_DE_VARIABLE: Record<string, { es: string; en: string }> = {
  contact_first_name: { es: 'nombre', en: 'name' },
  recipient_first_name: { es: 'nombre', en: 'name' },
  customer_name: { es: 'nombre', en: 'name' },
  order_name: { es: 'n.º de pedido', en: 'order #' },
  total_price_display: { es: 'total', en: 'total' },
  shipping_method: { es: 'envío', en: 'shipping' },
  tracking_url: { es: 'link de seguimiento', en: 'tracking link' },
  tracking_number: { es: 'n.º de guía', en: 'tracking #' },
  product_name: { es: 'producto', en: 'product' },
};

export default function TableroDeMensajesPage() {
  const t = useT();
  const [datos, setDatos] = useState<{
    comercio: string | null;
    producto: string;
    columnas: Columna[];
    plantillas: Record<string, Plantilla>;
  } | null>(null);
  const [conVariables, setConVariables] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/automations/tablero', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      setDatos(json);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('automations.tableroError'));
      setDatos((prev) => prev ?? { comercio: null, producto: '', columnas: [], plantillas: {} });
    }
  }, [t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Link href="/automatizaciones" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs">
            <ArrowLeft className="size-3.5" />
            {t('automations.pageTitle')}
          </Link>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('automations.tablero')}</h1>
          <p className="text-muted-foreground text-sm">{t('automations.tableroHint')}</p>
        </div>
        <div className="bg-muted inline-flex w-fit shrink-0 rounded-lg p-0.5">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setConVariables(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                conVariables === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v ? t('automations.tableroVariables') : t('automations.tableroEjemplo')}
            </button>
          ))}
        </div>
      </header>

      {!datos ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-24 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('automations.tableroCargando')}
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:overflow-x-auto md:pb-4">
          {datos.columnas.map((col) => (
            <section
              key={col.id}
              className="border-border bg-muted/30 w-full shrink-0 space-y-3 rounded-2xl border p-3 md:w-[330px]"
            >
              <div>
                <h2 className="text-foreground text-sm font-semibold">{t(TITULO[col.id.split('-')[0]] ?? col.escenario)}</h2>
                {col.oferta ? <p className="text-muted-foreground text-xs">{col.oferta}</p> : null}
              </div>
              {col.automatizaciones.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t('automations.tableroVacio')}</p>
              ) : (
                col.automatizaciones.map((a) => (
                  <Automatizacion
                    key={`${col.id}-${a.id}`}
                    a={a}
                    plantillas={datos.plantillas}
                    conVariables={conVariables}
                    onGuardada={(p) => {
                      setDatos((prev) => (prev ? { ...prev, plantillas: { ...prev.plantillas, [p.name]: p } } : prev));
                      void cargar();
                    }}
                  />
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Automatizacion({
  a,
  plantillas,
  conVariables,
  onGuardada,
}: {
  a: AutomacionSimulada;
  plantillas: Record<string, Plantilla>;
  conVariables: boolean;
  onGuardada: (p: Plantilla) => void;
}) {
  const t = useT();
  const estado = a.omitida ? null : a.apagada ? 'tableroBorrador' : a.armada ? 'tableroArmada' : 'tableroActiva';
  return (
    <div className="bg-card border-border space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={`/automatizaciones/${a.id}/editar`} className="text-foreground inline-flex min-w-0 items-center gap-1 text-sm font-medium hover:underline">
          <span className="truncate">{a.nombre}</span>
          <ExternalLink className="size-3 shrink-0 opacity-60" />
        </Link>
        {estado ? (
          <Badge variant={estado === 'tableroActiva' ? 'default' : 'outline'}>{t(`automations.${estado}`)}</Badge>
        ) : null}
      </div>
      {a.omitida ? (
        <p className="text-muted-foreground text-xs">{t('automations.tableroOmitida', { motivo: motivoDeOmision(t, a.omitida) })}</p>
      ) : null}
      {a.se_detiene_si_responde || a.ventana ? (
        <p className="text-muted-foreground text-[11px]">
          {[a.ventana, a.se_detiene_si_responde ? t('automations.tableroSeDetiene') : null].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <div
        className="space-y-1.5 rounded-lg px-2 py-2"
        style={{
          backgroundColor: '#e5ddd5',
          backgroundImage: 'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        {a.pasos.map((p, i) => (
          <Paso key={i} p={p} plantillas={plantillas} conVariables={conVariables} onGuardada={onGuardada} />
        ))}
        {a.agente ? <Chip texto={t('automations.tableroPasaA', { agente: a.agente.nombre })} icono="persona" /> : null}
      </div>
    </div>
  );
}

function Paso({
  p,
  plantillas,
  conVariables,
  onGuardada,
}: {
  p: PasoSimulado;
  plantillas: Record<string, Plantilla>;
  conVariables: boolean;
  onGuardada: (p: Plantilla) => void;
}) {
  const t = useT();
  if (p.tipo === 'espera') {
    return <Chip texto={t('automations.tableroEspera', { n: p.amount, unit: unidad(p.unit, p.amount) })} icono="espera" />;
  }
  if (p.tipo === 'condicion') return <Chip texto={t('automations.tableroSi', { desc: p.descripcion })} />;
  if (p.tipo === 'llamada') return <Chip texto={t('automations.tableroLlamada', { agente: p.agente ?? '—' })} icono="llamada" />;
  if (p.tipo === 'mensaje') return <Burbuja texto={p.texto} />;
  if (p.tipo !== 'plantilla') return null;
  return <PasoPlantilla p={p} plantilla={plantillas[p.nombre] ?? null} conVariables={conVariables} onGuardada={onGuardada} />;
}

function PasoPlantilla({
  p,
  plantilla,
  conVariables,
  onGuardada,
}: {
  p: Extract<PasoSimulado, { tipo: 'plantilla' }>;
  plantilla: Plantilla | null;
  conVariables: boolean;
  onGuardada: (p: Plantilla) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState('');
  const [guardando, setGuardando] = useState(false);
  const editable = Boolean(plantilla && ['draft', 'rejected'].includes(String(plantilla.status ?? '').toLowerCase()));
  const crudo = plantilla?.body_text ?? '';

  async function guardar() {
    if (!plantilla) return;
    setGuardando(true);
    try {
      const res = await fetchWithCsrf('/api/automations/tablero', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plantilla_id: plantilla.id, body_text: borrador }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.plantilla) throw new Error(json?.error ?? '');
      toast.success(t('automations.tableroGuardado'));
      setEditando(false);
      onGuardada(json.plantilla as Plantilla);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('automations.tableroErrorGuardar'));
    } finally {
      setGuardando(false);
    }
  }

  const leyenda = Object.entries(plantilla?.variable_fields ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([n, campo]) => `{{${n}}} ${nombreDeVariable(locale, campo)}`)
    .join(' · ');

  return (
    <div className="flex flex-col items-start">
      {editando ? (
        <div className="w-full space-y-1.5 rounded-lg bg-white p-2 shadow-sm">
          <textarea
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            rows={Math.min(14, Math.max(5, borrador.split('\n').length + 2))}
            maxLength={1024}
            autoFocus
            className="w-full resize-y rounded-md border border-[#d1d7db] px-2 py-1.5 text-base text-[#111b21] outline-none focus:border-[#00a884] sm:text-[13px]"
          />
          {leyenda ? <p className="text-[10px] text-[#54656f]">{leyenda}</p> : null}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={guardando}>
              {t('automations.tableroCancelar')}
            </Button>
            <Button size="sm" onClick={() => void guardar()} disabled={guardando || !borrador.trim()}>
              {guardando ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('automations.tableroGuardar')}
            </Button>
          </div>
        </div>
      ) : (
        <Burbuja texto={conVariables && crudo ? conNombres(locale, crudo, plantilla?.variable_fields ?? null) : p.texto} />
      )}
      {!editando && p.botones.length > 0 ? (
        <div className="mt-1 w-[92%] space-y-0.5">
          {p.botones.map((b, i) => (
            <div key={i} className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[13px] font-medium text-[#00a5f4] shadow-sm">
              {b.type === 'URL' ? <ExternalLink className="size-3.5" /> : b.type === 'QUICK_REPLY' ? <Reply className="size-3.5" /> : null}
              {b.text}
            </div>
          ))}
        </div>
      ) : null}
      {!editando ? (
        <div className="mt-0.5 flex w-[92%] items-center justify-between gap-2">
          <span className="truncate rounded bg-white/60 px-1.5 text-[10px] text-[#54656f]">
            {p.nombre}
            {plantilla?.status ? ` · ${plantilla.status}` : ''}
          </span>
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setBorrador(crudo);
                setEditando(true);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#008069] shadow-sm hover:bg-white/80"
            >
              <Pencil className="size-3" />
              {t('automations.tableroEditar')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Burbuja({ texto }: { texto: string }) {
  return (
    <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[13px] leading-snug text-[#111b21] shadow-sm">
      <p className="whitespace-pre-wrap break-words">{texto}</p>
    </div>
  );
}

function nombreDeVariable(locale: string, campo: string): string {
  const n = NOMBRE_DE_VARIABLE[campo];
  if (!n) return campo;
  return locale === 'en' ? n.en : n.es;
}

/** "Hola {{1}}" → "Hola [nombre]", para ver la plantilla sin el pedido de ejemplo. */
function conNombres(locale: string, texto: string, campos: Record<string, string> | null): string {
  return texto.replace(/\{\{(\d+)\}\}/g, (todo, n: string) => {
    const campo = campos?.[n];
    return campo ? `[${nombreDeVariable(locale, campo)}]` : todo;
  });
}

/** Los mismos motivos que muestra "Probar como cliente". */
function motivoDeOmision(t: ReturnType<typeof useT>, motivo: string): string {
  if (motivo.startsWith('platform:')) {
    return t('assistant.probarOmisionPlataforma', { tiendas: motivo.slice('platform:'.length), plataforma: 'shopify' });
  }
  const claves: Record<string, string> = {
    order_already_confirmed_or_paid: 'assistant.probarOmisionPagado',
    order_already_in_fulfillment: 'assistant.probarOmisionDespachado',
    order_cancelled_or_refunded: 'assistant.probarOmisionCancelado',
    tracking_not_verified: 'assistant.probarOmisionSinGuia',
    delivery_not_verified: 'assistant.probarOmisionSinEntrega',
    cancellation_not_verified: 'assistant.probarOmisionSinCancelacion',
  };
  return claves[motivo] ? t(claves[motivo]) : motivo;
}

function unidad(unit: string, n: number): string {
  const una = n === 1;
  if (unit === 'seconds') return una ? 'segundo' : 'segundos';
  if (unit === 'minutes') return una ? 'minuto' : 'minutos';
  if (unit === 'hours') return una ? 'hora' : 'horas';
  if (unit === 'days') return una ? 'día' : 'días';
  return unit;
}
