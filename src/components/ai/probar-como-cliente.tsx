'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Loader2, Phone, RotateCcw, Send, Timer, Wrench } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AutomacionSimulada, PasoSimulado } from '@/lib/automations/simulacion';
import type { Channel } from '@/types';

/**
 * Probar el comercio entero como si uno fuera el cliente.
 *
 * No se elige agente: se elige la SITUACIÓN (compra, carrito, despacho…) y el
 * canal. El servidor recorre las automatizaciones y muestra qué le llega al
 * cliente; después uno chatea y contesta el asistente que contestaría en vivo
 * —el que la automatización entregó, o el que el enrutamiento elige—, con una
 * etiqueta chica que dice cuál fue y por qué. Un comercio con dos asistentes
 * no tiene que saber cuál abrir.
 */

type Escenario =
  | 'mensaje'
  | 'shopify_order_created'
  | 'shopify_abandoned_checkout'
  | 'shopify_order_fulfilled'
  | 'shopify_order_delivered'
  | 'shopify_order_cancelled';

const ESCENARIOS: Array<{ id: Escenario; key: string }> = [
  { id: 'mensaje', key: 'assistant.probarEscMensaje' },
  { id: 'shopify_order_created', key: 'assistant.probarEscPedido' },
  { id: 'shopify_abandoned_checkout', key: 'assistant.probarEscCarrito' },
  { id: 'shopify_order_fulfilled', key: 'assistant.probarEscDespachado' },
  { id: 'shopify_order_delivered', key: 'assistant.probarEscEntregado' },
  { id: 'shopify_order_cancelled', key: 'assistant.probarEscCancelado' },
];

const CANALES: Array<{ id: Channel; label: string }> = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'webchat', label: 'Chat web' },
];

type Agente = { id: string; nombre: string; role?: string } | null;

type Turno =
  | { role: 'user'; texto: string }
  | {
      role: 'assistant';
      chunks: string[];
      agente: Agente;
      motivo: string;
      herramientas: string[];
    };

export function ProbarComoCliente() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [escenario, setEscenario] = useState<Escenario>('shopify_order_created');
  const [canal, setCanal] = useState<Channel>('whatsapp');
  const [productos, setProductos] = useState<Array<{ id: string; title: string }>>([]);
  const [productoId, setProductoId] = useState<string>('');
  const [pago, setPago] = useState<'cod' | 'paid'>('cod');
  const [guia, setGuia] = useState('');
  const [telefono, setTelefono] = useState('');

  const [simulando, setSimulando] = useState(false);
  const [automatizaciones, setAutomatizaciones] = useState<AutomacionSimulada[] | null>(null);
  const [agenteAsignado, setAgenteAsignado] = useState<Agente>(null);
  const [agenteActual, setAgenteActual] = useState<Agente>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/shopify/products')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const lista = (j?.products ?? []) as Array<{ id: string; title: string }>;
        setProductos(lista);
        if (lista[0]) setProductoId((prev) => prev || lista[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' });
  }, [turnos, automatizaciones]);

  const esEvento = escenario !== 'mensaje';
  const listoParaChatear = !esEvento || automatizaciones !== null;

  function reiniciar() {
    setAutomatizaciones(null);
    setAgenteAsignado(null);
    setAgenteActual(null);
    setTurnos([]);
  }

  async function simular() {
    reiniciar();
    if (!esEvento) {
      setAutomatizaciones([]);
      return;
    }
    setSimulando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/probar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escenario,
          channel: canal,
          product_id: productoId || undefined,
          pago,
          guia,
          simulated_phone: telefono || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      setAutomatizaciones(json.automatizaciones ?? []);
      setAgenteAsignado(json.agente_asignado ?? null);
    } catch {
      toast.error(t('assistant.probarFallo'));
    } finally {
      setSimulando(false);
    }
  }

  async function enviar() {
    const texto = mensaje.trim();
    if (!texto || enviando) return;
    const historial = turnos.map((turno) =>
      turno.role === 'user'
        ? { role: 'user', content: turno.texto }
        : { role: 'assistant', content: turno.chunks.join('\n') }
    );
    setTurnos((prev) => [...prev, { role: 'user', texto }]);
    setMensaje('');
    setEnviando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/probar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escenario,
          channel: canal,
          simulated_phone: telefono || undefined,
          message: texto,
          historial,
          agente_asignado: agenteAsignado?.id ?? null,
          agente_actual: agenteActual?.id ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      const agente = (json.agente ?? null) as Agente;
      const chunks: string[] =
        Array.isArray(json.chunks) && json.chunks.length > 0
          ? json.chunks
          : json.reply
            ? [json.reply]
            : [];
      setTurnos((prev) => [
        ...prev,
        {
          role: 'assistant',
          chunks,
          agente,
          motivo: String(json.motivo ?? ''),
          herramientas: Array.isArray(json.herramientas)
            ? (json.herramientas as unknown[]).map((h) =>
                typeof h === 'string' ? h : String((h as { name?: string })?.name ?? h)
              )
            : [],
        },
      ]);
      if (agente) setAgenteActual(agente);
    } catch {
      toast.error(t('assistant.probarFallo'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* ── Qué pasa ── */}
      <div className="space-y-3">
        <Campo label={t('assistant.probarEscenario')}>
          <Select value={escenario} onValueChange={(v) => { if (v) { setEscenario(v as Escenario); reiniciar(); } }}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ESCENARIOS.map((e) => (
                <SelectItem key={e.id} value={e.id}>{t(e.key)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label={t('assistant.probarCanal')}>
          <Select value={canal} onValueChange={(v) => { if (v) { setCanal(v as Channel); reiniciar(); } }}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CANALES.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        {esEvento && productos.length > 0 ? (
          <Campo label={t('assistant.probarProducto')}>
            <Select value={productoId} onValueChange={(v) => setProductoId(v ?? '')}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {productos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        ) : null}
        {escenario === 'shopify_order_created' ? (
          <Campo label={t('assistant.probarPago')}>
            <Select value={pago} onValueChange={(v) => { if (v) setPago(v as 'cod' | 'paid'); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cod">{t('assistant.probarPagoCod')}</SelectItem>
                <SelectItem value="paid">{t('assistant.probarPagoPagado')}</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        ) : null}
        {escenario === 'shopify_order_fulfilled' ? (
          <Campo label={t('assistant.probarGuia')} hint={t('assistant.probarGuiaHint')}>
            <Input value={guia} onChange={(e) => setGuia(e.target.value)} placeholder="RA123456789CO" />
          </Campo>
        ) : null}
        <Campo label={t('assistant.probarTelefono')} hint={t('assistant.probarTelefonoHint')}>
          <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+57 300 000 0000" />
        </Campo>
        <Button onClick={simular} disabled={simulando} className="w-full">
          {simulando ? <Loader2 className="size-4 animate-spin" /> : null}
          {t('assistant.probarSimular')}
        </Button>
      </div>

      {/* ── Lo que pasa ── */}
      <div className="border-border bg-background flex min-h-[420px] flex-col rounded-xl border">
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {esEvento && automatizaciones !== null ? (
            <section className="space-y-2">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t('assistant.probarLoQueLlega')}
              </h3>
              {automatizaciones.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('assistant.probarSinAutomatizaciones')}</p>
              ) : (
                automatizaciones.map((a) => <Automacion key={a.id} a={a} />)
              )}
            </section>
          ) : null}

          {turnos.map((turno, i) =>
            turno.role === 'user' ? (
              <Burbuja key={i} lado="der">
                <p className="whitespace-pre-wrap">{turno.texto}</p>
              </Burbuja>
            ) : (
              <div key={i} className="space-y-1">
                <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
                  <Bot className="size-3" />
                  {turno.agente
                    ? `${t('assistant.probarQuienContesta', { agente: turno.agente.nombre })} · ${motivoTexto(t, turno.motivo)}`
                    : turno.motivo === 'asignado_inactivo'
                      ? t('assistant.probarAsignadoInactivo')
                      : t('assistant.probarSinAgente')}
                </p>
                {turno.chunks.map((c, j) => (
                  <Burbuja key={j} lado="izq">
                    <p className="whitespace-pre-wrap">{c}</p>
                  </Burbuja>
                ))}
                {turno.herramientas.length > 0 ? (
                  <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    <Wrench className="size-3" />
                    {turno.herramientas.join(', ')}
                  </p>
                ) : null}
              </div>
            )
          )}
          {enviando ? (
            <Burbuja lado="izq">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </Burbuja>
          ) : null}
          <div ref={finRef} />
        </div>

        <div className="border-border flex items-center gap-2 border-t p-2">
          <Input
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={t('assistant.probarEscribi')}
            disabled={!listoParaChatear || enviando}
          />
          <Button size="icon" onClick={enviar} disabled={!listoParaChatear || enviando || !mensaje.trim()} aria-label={t('assistant.probarSimular')}>
            <Send className="size-4" />
          </Button>
          {turnos.length > 0 || automatizaciones ? (
            <Button size="icon" variant="ghost" onClick={reiniciar} aria-label={t('assistant.probarReiniciar')}>
              <RotateCcw className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function motivoTexto(t: ReturnType<typeof useT>, motivo: string): string {
  if (motivo === 'automatizacion') return t('assistant.probarMotivoAutomatizacion');
  if (motivo === 'pegado') return t('assistant.probarMotivoPegado');
  return t('assistant.probarMotivoEnrutamiento');
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-foreground text-xs font-medium">{label}</span>
      {children}
      {hint ? <span className="text-muted-foreground block text-[11px]">{hint}</span> : null}
    </label>
  );
}

function Burbuja({ lado, children }: { lado: 'izq' | 'der'; children: React.ReactNode }) {
  return (
    <div className={cn('flex', lado === 'der' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
          lado === 'der' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Automacion({ a }: { a: AutomacionSimulada }) {
  const t = useT();
  return (
    <div className="border-border rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-foreground text-sm font-medium">{a.nombre}</span>
        {a.agente ? (
          <span className="text-muted-foreground text-[11px]">
            → {t('assistant.probarQuienContesta', { agente: a.agente.nombre })}
          </span>
        ) : null}
        {a.ventana ? (
          <span className="text-muted-foreground text-[11px]">· {t('assistant.probarVentana', { ventana: a.ventana })}</span>
        ) : null}
        {a.se_detiene_si_responde ? (
          <span className="text-muted-foreground text-[11px]">· {t('assistant.probarSeDetiene')}</span>
        ) : null}
      </div>
      <ol className="mt-2 space-y-2">
        {a.pasos.map((p, i) => (
          <li key={i}>
            <Paso p={p} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Paso({ p }: { p: PasoSimulado }) {
  const t = useT();
  switch (p.tipo) {
    case 'plantilla':
    case 'mensaje': {
      const vacias = p.tipo === 'plantilla' ? p.vacias : [];
      return (
        <div className="space-y-1">
          <Burbuja lado="izq">
            <p className="whitespace-pre-wrap">{p.texto}</p>
            {p.tipo === 'plantilla' && p.botones.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.botones.map((b, i) => (
                  <span key={i} className="border-border rounded-md border px-2 py-0.5 text-xs">
                    {b.text}
                  </span>
                ))}
              </div>
            ) : null}
          </Burbuja>
          {p.tipo === 'plantilla' ? (
            <p className="text-muted-foreground text-[11px]">{p.nombre}</p>
          ) : null}
          {vacias.length > 0 ? (
            <p className="text-destructive text-[11px]">
              {t('assistant.probarVariableVacia', { detalle: vacias.join(', ') })}
            </p>
          ) : null}
        </div>
      );
    }
    case 'espera':
      return (
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Timer className="size-3" />
          {t('assistant.probarEspera', { n: p.amount, unit: p.unit })}
        </p>
      );
    case 'llamada':
      return (
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          <Phone className="size-3" />
          {t('assistant.probarLlamada', { agente: p.agente ?? '—' })}
        </p>
      );
    case 'condicion':
      return (
        <p className="text-muted-foreground text-xs">
          {t('assistant.probarCondicion', {
            desc: p.descripcion,
            camino: p.camino === 'yes' ? t('assistant.probarCaminoSi') : t('assistant.probarCaminoNo'),
          })}{' '}
          {p.asumido ? t('assistant.probarAsumido') : ''}
        </p>
      );
    case 'contexto':
      return null;
    default:
      return <p className="text-muted-foreground text-xs">{p.step_type}</p>;
  }
}
