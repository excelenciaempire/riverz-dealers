'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  CheckCheck,
  FastForward,
  Loader2,
  MessageSquareText,
  Phone,
  RotateCcw,
  Send,
  UserRound,
} from 'lucide-react';
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
 * Probar el comercio entero como si uno fuera el cliente, en un chat que se
 * ve y se siente como WhatsApp.
 *
 * No se elige agente: se elige la SITUACIÓN (compra, carrito, despacho…) y el
 * canal. Lo que las automatizaciones le mandarían al cliente aparece como
 * mensajes recibidos —plantillas ya rellenas, con sus botones—; las esperas
 * se muestran como "si no respondes, en 3 horas…" con un botón para adelantar
 * el reloj; y cuando uno escribe (o toca un botón de la plantilla), contesta
 * el asistente que contestaría en vivo, con una línea chica que dice cuál
 * fue y por qué. Un comercio con dos asistentes no tiene que saber cuál abrir.
 *
 * El tiempo es simulado a propósito: una espera de 21 horas no se puede
 * probar esperando 21 horas. Responder frena los recordatorios cuando la
 * automatización dice que se detiene al recibir respuesta, igual que en vivo.
 */

type Escenario =
  | 'mensaje'
  | 'shopify_order_created'
  | 'shopify_abandoned_checkout'
  | 'shopify_order_fulfilled'
  | 'shopify_order_delivered'
  | 'shopify_order_cancelled'
  | 'payment_rejected';

const ESCENARIOS: Array<{ id: Escenario; key: string }> = [
  { id: 'mensaje', key: 'assistant.probarEscMensaje' },
  { id: 'shopify_order_created', key: 'assistant.probarEscPedido' },
  { id: 'shopify_abandoned_checkout', key: 'assistant.probarEscCarrito' },
  { id: 'payment_rejected', key: 'assistant.probarEscPagoRechazado' },
  { id: 'shopify_order_fulfilled', key: 'assistant.probarEscDespachado' },
  { id: 'shopify_order_delivered', key: 'assistant.probarEscEntregado' },
  { id: 'shopify_order_cancelled', key: 'assistant.probarEscCancelado' },
];

/** `label` es el nombre de la marca tal cual, o una clave i18n (`assistant.`). */
const CANALES: Array<{ id: Channel; label: string }> = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'ig_comment', label: 'assistant.channelIgComments' },
  { id: 'fb_comment', label: 'assistant.channelFbComments' },
  { id: 'mercadolibre', label: 'Mercado Libre' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'webchat', label: 'assistant.channelWebchat' },
];

/** Por qué en vivo un comentario no se contestaría, en palabras. */
const MOTIVO_COMENTARIO: Record<string, string> = {
  comment_apagado: 'health.skip_comment_apagado',
  comment_red_apagada: 'health.skip_comment_red_apagada',
  comment_sin_texto: 'health.skip_comment_sin_texto',
  comment_sin_llave: 'health.skip_comment_sin_llave',
  sin_agente: 'health.skip_sin_agente',
  comment_sin_intencion: 'assistant.probarComentarioSinIntencion',
  comment_pide_humano: 'assistant.probarComentarioPidePersona',
  comment_tope_del_hilo: 'assistant.probarComentarioTope',
  comment_precio_no_autorizado: 'assistant.probarComentarioPrecio',
  comment_afirma_lo_que_no_sabe: 'assistant.probarComentarioAfirma',
  comment_prometia_averiguar: 'assistant.probarComentarioAveriguar',
  comment_respuesta_vacia: 'health.skip_comment_respuesta_vacia',
};

interface ResultadoComentario {
  publico: string | null;
  privado: string | null;
  oculto: 'critica' | 'spam' | null;
  escala: string | null;
  espera_aprobacion: boolean;
}

type Pago = 'cod' | 'mercadopago' | 'tarjeta';

type Agente = { id: string; nombre: string; role?: string } | null;

/** Lo que se ve en el hilo. `biz` es lo que manda el comercio (automatización o asistente). */
type Item =
  | { k: 'biz'; texto: string; botones: Array<{ text: string; type: string }>; nota?: string; alerta?: string; hora: string }
  | { k: 'me'; texto: string; hora: string }
  | { k: 'sys'; texto: string; icono?: 'espera' | 'llamada' | 'persona' }
  | { k: 'typing' };

/** Una automatización a medio recorrer: lo que falta después de una espera. */
interface Pendiente {
  auto: AutomacionSimulada;
  espera: { amount: number; unit: string };
  resto: PasoSimulado[];
}

export function ProbarComoCliente({ nombreComercio }: { nombreComercio?: string | null }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [escenario, setEscenario] = useState<Escenario>('shopify_order_created');
  const [canal, setCanal] = useState<Channel>('whatsapp');
  const [productos, setProductos] = useState<Array<{ id: string; title: string }>>([]);
  const [productoId, setProductoId] = useState('');
  const [pago, setPago] = useState<Pago>('cod');
  const [guia, setGuia] = useState('');
  const [telefono, setTelefono] = useState('');

  const [iniciado, setIniciado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [agenteAsignado, setAgenteAsignado] = useState<Agente>(null);
  const [agenteActual, setAgenteActual] = useState<Agente>(null);
  /** Lo que la automatización deja en la conversación; el asistente lo lee. */
  const [contexto, setContexto] = useState<Record<string, unknown> | null>(null);
  const [historial, setHistorial] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
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
    finRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [items]);

  const esEvento = escenario !== 'mensaje';
  const etiquetasEscenario = useMemo(
    () => Object.fromEntries(ESCENARIOS.map((e) => [e.id, t(e.key)])),
    [t]
  );
  const etiquetaDeCanal = (label: string) => (label.startsWith('assistant.') ? t(label) : label);
  const etiquetasCanal = useMemo(
    () => Object.fromEntries(CANALES.map((c) => [c.id, c.label.startsWith('assistant.') ? t(c.label) : c.label])),
    [t]
  );
  const etiquetasProducto = useMemo(
    () => Object.fromEntries(productos.map((p) => [p.id, p.title])),
    [productos]
  );
  const etiquetasPago: Record<Pago, string> = {
    cod: t('assistant.probarPagoCod'),
    mercadopago: 'Mercado Pago',
    tarjeta: t('assistant.probarPagoTarjeta'),
  };

  function reiniciar() {
    setIniciado(false);
    setItems([]);
    setPendientes([]);
    setAgenteAsignado(null);
    setAgenteActual(null);
    setContexto(null);
    setHistorial([]);
  }

  /** Las plantillas que ya le llegaron al cliente son parte del hilo que el asistente ve. */
  function recordar(items: Item[]) {
    const textos = items.filter((i): i is Extract<Item, { k: 'biz' }> => i.k === 'biz').map((i) => i.texto);
    if (textos.length) setHistorial((prev) => [...prev, ...textos.map((c) => ({ role: 'assistant' as const, content: c }))]);
  }

  /** Recorre pasos hasta la próxima espera; devuelve lo que queda. */
  function reproducir(auto: AutomacionSimulada, pasos: PasoSimulado[]): { items: Item[]; pendiente: Pendiente | null } {
    const out: Item[] = [];
    for (let i = 0; i < pasos.length; i++) {
      const p = pasos[i];
      if (p.tipo === 'plantilla' || p.tipo === 'mensaje') {
        out.push({
          k: 'biz',
          texto: p.texto,
          botones: p.tipo === 'plantilla' ? p.botones : [],
          nota: p.tipo === 'plantilla' ? p.nombre : undefined,
          alerta:
            p.tipo === 'plantilla' && p.vacias.length > 0
              ? t('assistant.probarVariableVacia', { detalle: p.vacias.join(', ') })
              : p.tipo === 'plantilla' && p.estado && p.estado.toLowerCase() !== 'approved'
                ? t('assistant.probarPlantillaNoAprobada', { estado: p.estado })
                : p.tipo === 'plantilla' && !p.estado
                  ? t('assistant.probarPlantillaNoExiste')
                  : undefined,
          hora: ahora(),
        });
      } else if (p.tipo === 'espera') {
        return { items: out, pendiente: { auto, espera: { amount: p.amount, unit: p.unit }, resto: pasos.slice(i + 1) } };
      } else if (p.tipo === 'llamada') {
        out.push({ k: 'sys', icono: 'llamada', texto: t('assistant.probarLlamada', { agente: p.agente ?? '—' }) });
      } else if (p.tipo === 'condicion') {
        out.push({
          k: 'sys',
          texto: `${t('assistant.probarCondicion', {
            desc: p.descripcion,
            camino: p.camino === 'yes' ? t('assistant.probarCaminoSi') : t('assistant.probarCaminoNo'),
          })}${p.asumido ? ` ${t('assistant.probarAsumido')}` : ''}`,
        });
      }
    }
    return { items: out, pendiente: null };
  }

  async function empezar() {
    reiniciar();
    setIniciado(true);
    if (!esEvento) return;
    setCargando(true);
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
      const autos = (json.automatizaciones ?? []) as AutomacionSimulada[];
      setAgenteAsignado(json.agente_asignado ?? null);
      const avisos: Item[] = [];
      if (json.whatsapp_conectado === false) avisos.push({ k: 'sys', icono: 'persona', texto: t('assistant.probarSinWhatsapp') });
      if (json.plataforma === null) avisos.push({ k: 'sys', texto: t('assistant.probarSinTienda') });
      // En vivo `automation_context` sólo queda cuando la automatización
      // entrega la conversación a un asistente.
      const conEntrega = autos.find((a) => a.agente && !a.omitida);
      setContexto(conEntrega?.contexto ?? null);
      if (autos.length === 0) {
        setItems([...avisos, { k: 'sys', texto: t('assistant.probarSinAutomatizaciones') }]);
        return;
      }
      const nuevos: Item[] = [...avisos];
      const pend: Pendiente[] = [];
      for (const auto of autos) {
        if (auto.omitida) {
          nuevos.push({ k: 'sys', texto: t('assistant.probarOmitida', { nombre: auto.nombre, motivo: motivoOmision(t, auto.omitida, json.plataforma ?? '') }) });
          continue;
        }
        const cabecera = [
          auto.nombre,
          auto.ventana ? t('assistant.probarVentana', { ventana: auto.ventana }) : null,
          auto.se_detiene_si_responde ? t('assistant.probarSeDetiene') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        nuevos.push({ k: 'sys', texto: cabecera });
        if (auto.armada && auto.armada.length > 0) {
          nuevos.push({
            k: 'sys',
            texto: t('assistant.probarArmada', {
              detalle: auto.armada.map((clave) => (clave.includes('.') ? t(clave) : clave)).join('; '),
            }),
          });
        }
        const r = reproducir(auto, auto.pasos);
        nuevos.push(...r.items);
        if (r.pendiente) {
          pend.push(r.pendiente);
          nuevos.push(...chipEspera(r.pendiente));
        }
      }
      setItems(nuevos);
      setPendientes(pend);
      recordar(nuevos);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setCargando(false);
    }
  }

  function chipEspera(p: Pendiente): Item[] {
    return [
      {
        k: 'sys',
        icono: 'espera',
        texto: t('assistant.probarSiNoRespondes', { n: p.espera.amount, unit: unidad(p.espera.unit, p.espera.amount) }),
      },
    ];
  }

  /** "Pasaron N horas": sigue la automatización hasta la próxima espera. */
  function avanzar(p: Pendiente) {
    setPendientes((prev) => prev.filter((x) => x !== p));
    const r = reproducir(p.auto, p.resto);
    const nuevos: Item[] = [
      { k: 'sys', icono: 'espera', texto: t('assistant.probarPasaron', { n: p.espera.amount, unit: unidad(p.espera.unit, p.espera.amount) }) },
      ...r.items,
    ];
    if (r.pendiente) {
      setPendientes((prev) => [...prev, r.pendiente as Pendiente]);
      nuevos.push(...chipEspera(r.pendiente));
    }
    setItems((prev) => [...prev, ...nuevos]);
    recordar(nuevos);
  }

  async function enviar(textoCrudo?: string) {
    const texto = (textoCrudo ?? mensaje).trim();
    if (!texto || enviando) return;
    if (!iniciado) setIniciado(true);
    // Responder frena los recordatorios que se detienen al recibir respuesta.
    const frenados = pendientes.filter((p) => p.auto.se_detiene_si_responde);
    if (frenados.length > 0) {
      setPendientes((prev) => prev.filter((p) => !p.auto.se_detiene_si_responde));
    }
    setItems((prev) => [
      ...prev,
      { k: 'me', texto, hora: ahora() },
      ...(frenados.length > 0 ? [{ k: 'sys', texto: t('assistant.probarSeDetuvo') } as Item] : []),
      { k: 'typing' },
    ]);
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
          automation_context: contexto,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      const agente = (json.agente ?? null) as Agente;
      // Un comentario: lo que se publicaría y lo que llegaría por privado, o
      // por qué en vivo no saldría nada (incluido el ocultarlo).
      if (json.comentario) {
        const c = json.comentario as ResultadoComentario;
        const nuevos: Item[] = [];
        if (json.barrera) {
          const b = json.barrera as { tipo: string; detalle: string | null };
          const clave = MOTIVO_COMENTARIO[b.tipo];
          const motivo = clave ? t(clave, { n: b.detalle ?? '', detalle: b.detalle ?? '' }) : b.tipo;
          nuevos.push({ k: 'sys', texto: t('assistant.probarComentarioNoSale', { motivo }) });
        } else if (c.oculto) {
          nuevos.push({
            k: 'sys',
            texto: t(c.oculto === 'spam' ? 'assistant.probarComentarioOcultoSpam' : 'assistant.probarComentarioOcultoCritica'),
          });
        } else {
          const quien = agente ? ` · ${t('assistant.probarQuienContesta', { agente: agente.nombre })}` : '';
          if (c.publico) {
            nuevos.push({ k: 'biz', texto: c.publico, botones: [], hora: ahora(), nota: `${t('assistant.probarComentarioPublico')}${quien}` });
          }
          if (c.privado) {
            nuevos.push({ k: 'biz', texto: c.privado, botones: [], hora: ahora(), nota: t('assistant.probarComentarioPrivado') });
          }
          if (c.escala) {
            const motivo =
              c.escala === 'reclamo'
                ? t('assistant.probarEscalaReclamo')
                : c.escala === 'pedido'
                  ? t('assistant.probarEscalaPedido')
                  : t('assistant.probarEscalaPago');
            nuevos.push({ k: 'sys', icono: 'persona', texto: t('assistant.probarComentarioEscala', { motivo }) });
          }
          if (c.espera_aprobacion) nuevos.push({ k: 'sys', texto: t('assistant.probarComentarioAprobacion') });
        }
        setItems((prev) => [...prev.filter((i) => i.k !== 'typing'), ...nuevos]);
        const respuesta = c.privado || c.publico;
        setHistorial((prev) => [
          ...prev,
          { role: 'user', content: texto },
          ...(respuesta ? [{ role: 'assistant' as const, content: respuesta }] : []),
        ]);
        if (agente) setAgenteActual(agente);
        return;
      }
      if (json.barrera) {
        // Una barrera del runner: en vivo el asistente no contesta.
        const b = json.barrera as { tipo: string; detalle: string | null };
        setItems((prev) => [
          ...prev.filter((i) => i.k !== 'typing'),
          { k: 'sys', icono: b.tipo === 'baja' || b.tipo === 'alta' ? undefined : 'persona', texto: barreraTexto(t, b) },
        ]);
        setHistorial((prev) => [...prev, { role: 'user', content: texto }]);
        if (agente) setAgenteActual(agente);
        return;
      }
      const chunks: string[] =
        Array.isArray(json.chunks) && json.chunks.length > 0 ? json.chunks : json.reply ? [json.reply] : [];
      const herramientas = Array.isArray(json.herramientas)
        ? (json.herramientas as unknown[]).map((h) => (typeof h === 'string' ? h : String((h as { name?: string })?.name ?? h)))
        : [];
      const quien = agente
        ? `${t('assistant.probarQuienContesta', { agente: agente.nombre })} · ${motivoTexto(t, String(json.motivo ?? ''))}${herramientas.length ? ` · ${herramientas.join(', ')}` : ''}`
        : json.motivo === 'asignado_inactivo'
          ? t('assistant.probarAsignadoInactivo')
          : t('assistant.probarSinAgente');
      setItems((prev) => [
        ...prev.filter((i) => i.k !== 'typing'),
        ...chunks.map((c, i): Item => ({ k: 'biz', texto: c, botones: [], hora: ahora(), nota: i === chunks.length - 1 ? quien : undefined })),
        ...(chunks.length === 0 ? [{ k: 'sys', texto: quien } as Item] : []),
      ]);
      setHistorial((prev) => [...prev, { role: 'user', content: texto }, ...(chunks.length ? [{ role: 'assistant' as const, content: chunks.join('\n') }] : [])]);
      if (agente) setAgenteActual(agente);
    } catch (err) {
      setItems((prev) => prev.filter((i) => i.k !== 'typing'));
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setEnviando(false);
    }
  }

  const inicial = (nombreComercio ?? 'R').trim().charAt(0).toUpperCase() || 'R';

  return (
    <div className="space-y-4">
      {/* ── Qué pasa ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Campo label={t('assistant.probarEscenario')}>
          <Select value={escenario} onValueChange={(v) => { if (v) { setEscenario(v as Escenario); reiniciar(); } }}>
            <SelectTrigger className="w-full"><SelectValue labels={etiquetasEscenario} /></SelectTrigger>
            <SelectContent>
              {ESCENARIOS.map((e) => <SelectItem key={e.id} value={e.id}>{t(e.key)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Campo>
        <Campo label={t('assistant.probarCanal')} hint={esEvento ? t('assistant.probarSoloWhatsapp') : undefined}>
          <Select value={esEvento ? 'whatsapp' : canal} disabled={esEvento} onValueChange={(v) => { if (v) { setCanal(v as Channel); reiniciar(); } }}>
            <SelectTrigger className="w-full"><SelectValue labels={etiquetasCanal} /></SelectTrigger>
            <SelectContent>
              {CANALES.map((c) => <SelectItem key={c.id} value={c.id}>{etiquetaDeCanal(c.label)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Campo>
        {esEvento ? (
          <Campo label={t('assistant.probarProducto')}>
            <Select value={productoId} disabled={productos.length === 0} onValueChange={(v) => setProductoId(v ?? '')}>
              <SelectTrigger className="w-full"><SelectValue labels={etiquetasProducto} placeholder="—" /></SelectTrigger>
              <SelectContent>
                {productos.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
        ) : null}
        {escenario === 'shopify_order_created' ? (
          <Campo label={t('assistant.probarPago')}>
            <Select value={pago} onValueChange={(v) => { if (v) setPago(v as Pago); }}>
              <SelectTrigger className="w-full"><SelectValue labels={etiquetasPago} /></SelectTrigger>
              <SelectContent>
                {(Object.keys(etiquetasPago) as Pago[]).map((p) => <SelectItem key={p} value={p}>{etiquetasPago[p]}</SelectItem>)}
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
          <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+57 300 000 0000" inputMode="tel" />
        </Campo>
      </div>

      {/* ── El chat ── */}
      <div className="border-border flex h-[60vh] min-h-[440px] flex-col overflow-hidden rounded-xl border bg-[#efeae2] shadow-sm dark:bg-[#0b141a]">
        <div className="flex items-center gap-3 border-b border-black/5 bg-[#f0f2f5] px-4 py-2.5 dark:border-white/5 dark:bg-[#202c33]">
          <div className="grid size-9 place-items-center rounded-full bg-[#00a884] text-sm font-semibold text-white">
            {inicial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[#111b21] dark:text-[#e9edef]">
              {nombreComercio || t('assistant.probarTitle')}
            </p>
            <p className="truncate text-xs text-[#667781] dark:text-[#8696a0]">
              {agenteActual ? agenteActual.nombre : t('assistant.probarEnLinea')}
            </p>
          </div>
          {iniciado ? (
            <Button size="sm" variant="ghost" onClick={reiniciar} className="text-[#54656f] dark:text-[#aebac1]">
              <RotateCcw className="size-4" />
              {t('assistant.probarReiniciar')}
            </Button>
          ) : null}
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
          {!iniciado ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-white/70 text-[#54656f] dark:bg-[#202c33] dark:text-[#aebac1]">
                <MessageSquareText className="size-5" />
              </div>
              <p className="max-w-xs text-sm text-[#54656f] dark:text-[#aebac1]">{t('assistant.probarVacio')}</p>
              <Button onClick={empezar} disabled={cargando} className="bg-[#00a884] text-white hover:bg-[#029b78]">
                {cargando ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('assistant.probarEmpezar')}
              </Button>
            </div>
          ) : null}
          {iniciado && !cargando ? <Chip texto={t('assistant.probarHoy')} /> : null}
          {cargando ? (
            <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-[#54656f]" /></div>
          ) : null}
          {items.map((it, i) => (
            <Linea key={i} it={it} onBoton={(texto) => void enviar(texto)} />
          ))}
          <div ref={finRef} />
        </div>

        {pendientes.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-black/5 bg-[#f0f2f5]/80 px-3 py-2 dark:border-white/5 dark:bg-[#202c33]/80">
            {pendientes.map((p, i) => (
              <Button key={i} size="sm" variant="outline" onClick={() => avanzar(p)} disabled={enviando} className="rounded-full">
                <FastForward className="size-3.5" />
                {t('assistant.probarPasaron', { n: p.espera.amount, unit: unidad(p.espera.unit, p.espera.amount) })}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2 border-t border-black/5 bg-[#f0f2f5] p-2 dark:border-white/5 dark:bg-[#202c33]">
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
            disabled={enviando || cargando}
            className="rounded-full border-transparent bg-white dark:bg-[#2a3942]"
          />
          <Button
            size="icon"
            className="rounded-full bg-[#00a884] text-white hover:bg-[#029b78]"
            onClick={() => void enviar()}
            disabled={enviando || cargando || !mensaje.trim()}
            aria-label={t('assistant.probarEmpezar')}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">{label}</span>
      {children}
      {hint ? <span className="text-muted-foreground block text-[11px]">{hint}</span> : null}
    </label>
  );
}

function Chip({ texto, icono }: { texto: string; icono?: 'espera' | 'llamada' | 'persona' }) {
  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex max-w-[92%] items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 text-center text-[11px] text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#aebac1]">
        {icono === 'espera' ? <FastForward className="size-3 shrink-0" /> : null}
        {icono === 'llamada' ? <Phone className="size-3 shrink-0" /> : null}
        {icono === 'persona' ? <UserRound className="size-3 shrink-0" /> : null}
        {texto}
      </span>
    </div>
  );
}

function Linea({ it, onBoton }: { it: Item; onBoton: (texto: string) => void }) {
  if (it.k === 'sys') return <Chip texto={it.texto} icono={it.icono} />;
  if (it.k === 'typing') {
    return (
      <div className="flex justify-start">
        <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm shadow-sm dark:bg-[#202c33]">
          <span className="animate-pulse text-[#8696a0]">•••</span>
        </div>
      </div>
    );
  }
  if (it.k === 'me') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-1.5 text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
          <p className="whitespace-pre-wrap">{it.texto}</p>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781] dark:text-[#8696a0]">
            {it.hora} <CheckCheck className="size-3 text-[#53bdeb]" />
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[78%] rounded-lg rounded-tl-none bg-white text-sm text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
        <div className="px-3 py-1.5">
          <p className="whitespace-pre-wrap">{it.texto}</p>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781] dark:text-[#8696a0]">
            {it.hora} <Check className="size-3" />
          </p>
        </div>
        {it.botones.length > 0 ? (
          <div className="border-t border-black/5 dark:border-white/10">
            {it.botones.map((b, i) => (
              <button
                key={i}
                type="button"
                onClick={() => (b.type === 'QUICK_REPLY' ? onBoton(b.text) : undefined)}
                className={cn(
                  'block w-full py-2 text-center text-[13px] font-medium text-[#027eb5] dark:text-[#53bdeb]',
                  i > 0 && 'border-t border-black/5 dark:border-white/10',
                  b.type === 'QUICK_REPLY' ? 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]' : 'cursor-default'
                )}
              >
                {b.text}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {it.nota ? <p className="mt-0.5 pl-1 text-[10px] text-[#667781] dark:text-[#8696a0]">{it.nota}</p> : null}
      {it.alerta ? <p className="text-destructive mt-0.5 pl-1 text-[10px]">{it.alerta}</p> : null}
    </div>
  );
}

function barreraTexto(t: ReturnType<typeof useT>, b: { tipo: string; detalle: string | null }): string {
  if (b.tipo === 'baja') return t('assistant.probarBarreraBaja');
  if (b.tipo === 'alta') return t('assistant.probarBarreraAlta');
  if (b.tipo === 'respuesta_automatica') return t('assistant.probarBarreraContestador');
  if (b.tipo === 'escalation_keyword') return t('assistant.probarBarreraPersona', { detalle: b.detalle ?? '' });
  if (b.tipo === 'problema_detectado') return t('assistant.probarBarreraProblema', { detalle: b.detalle ?? '' });
  if (b.tipo === 'tope_respuestas') return t('assistant.probarBarreraTope', { n: b.detalle ?? '' });
  if (b.tipo === 'precio_no_autorizado') return t('assistant.probarBarreraPrecio', { detalle: b.detalle ?? '' });
  if (b.tipo === 'respuesta_prohibida') return t('assistant.probarBarreraProhibida', { detalle: b.detalle ?? '' });
  return b.tipo;
}

/** Los motivos de la barrera de DeUNA, en palabras. */
function motivoOmision(t: ReturnType<typeof useT>, motivo: string, plataforma: string): string {
  if (motivo.startsWith('platform:')) {
    return t('assistant.probarOmisionPlataforma', { tiendas: motivo.slice('platform:'.length), plataforma });
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

function motivoTexto(t: ReturnType<typeof useT>, motivo: string): string {
  if (motivo === 'automatizacion') return t('assistant.probarMotivoAutomatizacion');
  if (motivo === 'pegado') return t('assistant.probarMotivoPegado');
  return t('assistant.probarMotivoEnrutamiento');
}

function ahora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function unidad(unit: string, n: number): string {
  const una = n === 1;
  if (unit === 'seconds') return una ? 'segundo' : 'segundos';
  if (unit === 'minutes') return una ? 'minuto' : 'minutos';
  if (unit === 'hours') return una ? 'hora' : 'horas';
  if (unit === 'days') return una ? 'día' : 'días';
  return unit;
}
