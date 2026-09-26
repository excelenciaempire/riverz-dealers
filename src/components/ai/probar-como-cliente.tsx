'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ExternalLink,
  FastForward,
  Link2,
  Loader2,
  MessageSquareText,
  NotebookPen,
  RotateCcw,
  Send,
  Sparkles,
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
import {
  BotonDeTelefono,
  CANALES_DE_PRUEBA,
  Chip,
  ESCENARIOS_DE_PRUEBA,
  Linea,
  MarcoDeTelefono,
  type EscenarioDePrueba,
  type ItemChat,
  type MarcaDeFeedback,
} from '@/components/ai/chat-de-prueba';
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
 *
 * Cada prueba —de Empezar a Reiniciar— se guarda como un chat, con lo que
 * quien probaba marcó en cada respuesta (`lib/ai/sesiones-de-prueba`).
 */

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

type Pago = 'cod' | 'pendiente' | 'transferencia' | 'mercadopago' | 'tarjeta';

type Agente = { id: string; nombre: string; role?: string; apagado?: boolean } | null;

type Item = ItemChat;

/** Una automatización a medio recorrer: lo que falta después de una espera. */
interface Pendiente {
  auto: AutomacionSimulada;
  espera: { amount: number; unit: string };
  resto: PasoSimulado[];
}

export function ProbarComoCliente({
  nombreComercio: nombreInicial,
  token,
  onRevisar,
}: {
  nombreComercio?: string | null;
  /** El link compartido: se prueba sin sesión, sin elegir teléfono y sin
   *  poder generar otro link. */
  token?: string;
  /** Abre la prueba guardada para convertir el feedback en mejoras. */
  onRevisar?: (sesionId: string) => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [escenario, setEscenario] = useState<EscenarioDePrueba>('shopify_order_created');
  const [canal, setCanal] = useState<Channel>('whatsapp');
  /** Los productos del comercio (las variantes y publicaciones ya agrupadas), con sus ofertas. */
  const [productos, setProductos] = useState<ProductoDePrueba[]>([]);
  const [productoId, setProductoId] = useState('');
  /** La oferta elegida (unidades), si el producto tiene ofertas. */
  const [unidades, setUnidades] = useState('');
  /** Sin contra entrega no se ofrece simular un pedido contra entrega; sin transferencia, tampoco. */
  const [aceptaContraentrega, setAceptaContraentrega] = useState(false);
  const [aceptaTransferencia, setAceptaTransferencia] = useState(false);
  const [nombreComercio, setNombreComercio] = useState<string | null>(nombreInicial ?? null);
  const [telefonoEjemplo, setTelefonoEjemplo] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [pago, setPago] = useState<Pago>('mercadopago');
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

  /** La prueba en curso, como chat guardado. Nace al empezar y muere al reiniciar. */
  const [sesionId, setSesionId] = useState<string | null>(null);
  /** Lo que se marcó en cada respuesta, por posición en `items`. */
  const [marcas, setMarcas] = useState<Record<number, MarcaDeFeedback>>({});
  const [comentario, setComentario] = useState('');
  const [verComentario, setVerComentario] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const guardado = useRef('');
  const hiloRef = useRef<HTMLDivElement | null>(null);
  const telefonoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/ai/probar${token ? `?token=${encodeURIComponent(token)}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        const lista = leerProductos(
          (j.productos ?? []) as Array<{ id: string; title: string; allowed_offers?: unknown }>
        );
        setProductos(lista);
        if (lista[0]) {
          setProductoId((prev) => prev || lista[0].id);
          setUnidades((prev) => prev || (lista[0].ofertas[0] ? String(lista[0].ofertas[0].units) : ''));
        }
        setAceptaContraentrega(j.acepta_contraentrega === true);
        setAceptaTransferencia(Array.isArray(j.medios_pago) && j.medios_pago.includes('transferencia'));
        if (j.acepta_contraentrega === true) setPago('cod');
        if (typeof j.comercio === 'string' && j.comercio) setNombreComercio(j.comercio);
        if (typeof j.telefono_ejemplo === 'string') setTelefonoEjemplo(j.telefono_ejemplo);
      })
      .catch(() => {});
  }, [token]);

  async function compartir() {
    setGenerandoLink(true);
    try {
      const res = await fetchWithCsrf('/api/ai/probar/compartir', { method: 'POST' });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) throw new Error(json?.error ?? '');
      setLink(json.url);
      await navigator.clipboard?.writeText(json.url).catch(() => {});
      toast.success(t('assistant.probarLinkCopiado'));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setGenerandoLink(false);
    }
  }

  // Se baja el hilo, no la página: en el celular, bajar la página escondía
  // los controles cada vez que llegaba un mensaje.
  useEffect(() => {
    const el = hiloRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [items]);

  const esEvento = escenario !== 'mensaje';
  const etiquetasEscenario = useMemo(
    () => Object.fromEntries(ESCENARIOS_DE_PRUEBA.map((e) => [e.id, t(e.key)])),
    [t]
  );
  const etiquetaDeCanal = (label: string) => (label.startsWith('assistant.') ? t(label) : label);
  const etiquetasCanal = useMemo(
    () => Object.fromEntries(CANALES_DE_PRUEBA.map((c) => [c.id, c.label.startsWith('assistant.') ? t(c.label) : c.label])),
    [t]
  );
  const etiquetasProducto = useMemo(
    () => Object.fromEntries(productos.map((p) => [p.id, p.title])),
    [productos]
  );
  const producto = productos.find((p) => p.id === productoId) ?? null;
  const etiquetasOferta = useMemo(
    () => Object.fromEntries((producto?.ofertas ?? []).map((o) => [String(o.units), o.label])),
    [producto]
  );
  const etiquetasPago: Record<string, string> = {
    ...(aceptaContraentrega ? { cod: t('assistant.probarPagoCod') } : {}),
    mercadopago: 'Mercado Pago',
    tarjeta: t('assistant.probarPagoTarjeta'),
    ...(aceptaTransferencia ? { transferencia: t('assistant.probarPagoTransferencia') } : {}),
    pendiente: t('assistant.probarPagoPendiente'),
  };

  // ── Guardar la prueba ──

  function paquete(id: string, its: Item[], ms: Record<number, MarcaDeFeedback>, com: string) {
    // "Escribiendo…" sólo va al final del hilo, así que sacarlo no corre las
    // posiciones de las marcas.
    const limpios = its.filter((i) => i.k !== 'typing');
    const at = new Date().toISOString();
    const feedback = [
      ...Object.entries(ms)
        .filter(([, m]) => m.voto || m.nota.trim())
        .map(([i, m]) => ({ item: Number(i), voto: m.voto, nota: m.nota.trim(), at })),
      ...(com.trim() ? [{ item: null, voto: null, nota: com.trim(), at }] : []),
    ];
    return {
      token,
      id,
      escenario,
      canal: esEvento ? 'whatsapp' : canal,
      detalle: {
        producto: esEvento
          ? [producto?.title, etiquetasOferta[unidades]].filter(Boolean).join(' · ') || null
          : null,
        pago: escenario === 'shopify_order_created' ? pago : null,
      },
      items: limpios,
      feedback,
    };
  }

  async function mandarSesion(cuerpo: string): Promise<boolean> {
    try {
      const res = await fetchWithCsrf('/api/ai/probar/sesiones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cuerpo,
      });
      if (res.ok) guardado.current = cuerpo;
      return res.ok;
    } catch {
      return false;
    }
  }

  // Sin apuro y sin avisar: guardar la prueba no puede interrumpirla.
  useEffect(() => {
    if (!sesionId || items.some((i) => i.k === 'typing')) return;
    const p = paquete(sesionId, items, marcas, comentario);
    if (p.items.length === 0 && p.feedback.length === 0) return;
    const cuerpo = JSON.stringify(p);
    if (cuerpo === guardado.current) return;
    const espera = setTimeout(() => void mandarSesion(cuerpo), 900);
    return () => clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesionId, items, marcas, comentario]);

  /** Lo último que falte guardar, ya. */
  async function guardarYa(): Promise<void> {
    if (!sesionId) return;
    const p = paquete(sesionId, items, marcas, comentario);
    if (p.items.length === 0 && p.feedback.length === 0) return;
    const cuerpo = JSON.stringify(p);
    if (cuerpo !== guardado.current) await mandarSesion(cuerpo);
  }

  function reiniciar() {
    void guardarYa();
    setSesionId(null);
    setMarcas({});
    setComentario('');
    setVerComentario(false);
    setIniciado(false);
    setItems([]);
    setPendientes([]);
    setAgenteAsignado(null);
    setAgenteActual(null);
    setContexto(null);
    setHistorial([]);
  }

  async function revisar() {
    if (!sesionId || !onRevisar) return;
    setRevisando(true);
    await guardarYa();
    setRevisando(false);
    onRevisar(sesionId);
  }

  const hayFeedback =
    comentario.trim().length > 0 || Object.values(marcas).some((m) => m.voto || m.nota.trim());

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
        // El chat muestra lo que vive el cliente: el mensaje y sus botones.
        // El nombre de la plantilla y su estado en Meta son del equipo y se
        // ven en Plantillas y en el tablero, no acá.
        out.push({
          k: 'biz',
          texto: p.texto,
          botones: p.tipo === 'plantilla' ? p.botones : [],
          opinable: true,
          hora: ahora(),
        });
      } else if (p.tipo === 'espera') {
        return { items: out, pendiente: { auto, espera: { amount: p.amount, unit: p.unit }, resto: pasos.slice(i + 1) } };
      } else if (p.tipo === 'llamada') {
        out.push({ k: 'sys', icono: 'llamada', texto: t('assistant.probarLlamada', { agente: p.agente ?? '—' }) });
      }
      // Las condiciones no se muestran: son la lógica por dentro, escrita como
      // código («financial_status eq pending»). El chat ya muestra el camino
      // que resulta de ellas, que es lo que vive el cliente.
    }
    return { items: out, pendiente: null };
  }

  async function empezar() {
    reiniciar();
    setIniciado(true);
    setSesionId(nuevoId());
    // En el celular los controles van arriba del teléfono: al empezar, el
    // chat queda a la vista.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      telefonoRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    if (!esEvento) return;
    setCargando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/probar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          escenario,
          channel: canal,
          product_id: productoId || undefined,
          unidades: Number(unidades) || undefined,
          pago,
          guia,
          simulated_phone: telefono || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '');
      const autos = (json.automatizaciones ?? []) as AutomacionSimulada[];
      setAgenteAsignado(json.agente_asignado ?? null);
      // En vivo `automation_context` sólo queda cuando la automatización
      // entrega la conversación a un asistente.
      const conEntrega = autos.find((a) => a.agente && !a.omitida);
      setContexto(conEntrega?.contexto ?? null);
      // El chat es lo que vive el cliente y nada más: sin el nombre de cada
      // automatización, si está apagada, sus condiciones o por qué una no
      // corre. Eso es del equipo y está en el tablero y en Automatizaciones;
      // acá se leía como ruido y tapaba la conversación.
      const envia = (a: AutomacionSimulada) =>
        !a.omitida && a.pasos.some((p) => p.tipo === 'plantilla' || p.tipo === 'mensaje' || p.tipo === 'llamada');
      if (!autos.some(envia)) {
        setItems([{ k: 'sys', texto: t('assistant.probarSinAutomatizaciones') }]);
        return;
      }
      const nuevos: Item[] = [];
      const pend: Pendiente[] = [];
      for (const auto of autos) {
        if (!envia(auto)) continue;
        const r = reproducir(auto, auto.pasos);
        nuevos.push(...r.items);
        // La espera se ve como el botón «Pasaron N» debajo del chat.
        if (r.pendiente) pend.push(r.pendiente);
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

  /** "Pasaron N horas": sigue la automatización hasta la próxima espera. */
  function avanzar(p: Pendiente) {
    setPendientes((prev) => prev.filter((x) => x !== p));
    const r = reproducir(p.auto, p.resto);
    const nuevos: Item[] = [
      { k: 'sys', icono: 'espera', texto: t('assistant.probarPasaron', { n: p.espera.amount, unit: unidad(t, p.espera.unit, p.espera.amount) }) },
      ...r.items,
    ];
    if (r.pendiente) setPendientes((prev) => [...prev, r.pendiente as Pendiente]);
    setItems((prev) => [...prev, ...nuevos]);
    recordar(nuevos);
  }

  async function enviar(textoCrudo?: string) {
    const texto = (textoCrudo ?? mensaje).trim();
    if (!texto || enviando) return;
    if (!iniciado) setIniciado(true);
    if (!sesionId) setSesionId(nuevoId());
    // Responder frena los recordatorios que se detienen al recibir respuesta.
    const frenados = pendientes.filter((p) => p.auto.se_detiene_si_responde);
    if (frenados.length > 0) {
      setPendientes((prev) => prev.filter((p) => !p.auto.se_detiene_si_responde));
    }
    setItems((prev) => [...prev, { k: 'me', texto, hora: ahora() }, { k: 'typing' }]);
    setMensaje('');
    setEnviando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/probar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
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
          if (c.publico) {
            nuevos.push({ k: 'biz', texto: c.publico, botones: [], hora: ahora(), nota: t('assistant.probarComentarioPublico'), opinable: true });
          }
          if (c.privado) {
            nuevos.push({ k: 'biz', texto: c.privado, botones: [], hora: ahora(), nota: t('assistant.probarComentarioPrivado'), opinable: true });
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
      // Sin quién contestó, por qué ni qué herramientas usó: el cliente no lo
      // ve. Sólo se avisa cuando nadie contestaría.
      const sinRespuesta =
        json.motivo === 'asignado_inactivo' ? t('assistant.probarAsignadoInactivo') : t('assistant.probarSinAgente');
      setItems((prev) => [
        ...prev.filter((i) => i.k !== 'typing'),
        ...chunks.map((c, i): Item => ({ k: 'biz', texto: c, botones: [], hora: ahora(), opinable: i === chunks.length - 1 })),
        ...(chunks.length === 0 ? [{ k: 'sys', texto: sinRespuesta } as Item] : []),
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

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      {/* ── Qué pasa ── */}
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Campo label={t('assistant.probarEscenario')}>
            <Select value={escenario} onValueChange={(v) => { if (v) { setEscenario(v as EscenarioDePrueba); reiniciar(); } }}>
              <SelectTrigger className="w-full"><SelectValue labels={etiquetasEscenario} /></SelectTrigger>
              <SelectContent>
                {ESCENARIOS_DE_PRUEBA.map((e) => <SelectItem key={e.id} value={e.id}>{t(e.key)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label={t('assistant.probarCanal')}>
            <Select value={esEvento ? 'whatsapp' : canal} disabled={esEvento} onValueChange={(v) => { if (v) { setCanal(v as Channel); reiniciar(); } }}>
              <SelectTrigger className="w-full"><SelectValue labels={etiquetasCanal} /></SelectTrigger>
              <SelectContent>
                {CANALES_DE_PRUEBA.map((c) => <SelectItem key={c.id} value={c.id}>{etiquetaDeCanal(c.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          {/* Un producto con sus ofertas es UN producto: se elige la oferta,
              no "cuatro productos" con el mismo nombre. */}
          {esEvento && productos.length > 1 ? (
            <Campo label={t('assistant.probarProducto')} className="col-span-2 sm:col-span-1">
              <Select
                value={productoId}
                onValueChange={(v) => {
                  const p = productos.find((x) => x.id === v);
                  setProductoId(v ?? '');
                  setUnidades(p?.ofertas[0] ? String(p.ofertas[0].units) : '');
                }}
              >
                <SelectTrigger className="w-full"><SelectValue labels={etiquetasProducto} placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {productos.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
          ) : null}
          {esEvento && producto && producto.ofertas.length > 0 ? (
            <Campo label={t('assistant.probarOferta')} className="col-span-2 sm:col-span-1">
              <Select value={unidades} onValueChange={(v) => setUnidades(v ?? '')}>
                <SelectTrigger className="w-full"><SelectValue labels={etiquetasOferta} placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {producto.ofertas.map((o) => <SelectItem key={o.units} value={String(o.units)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
          ) : null}
          {escenario === 'shopify_order_created' ? (
            <Campo label={t('assistant.probarPago')} className="col-span-2 sm:col-span-1">
              <Select value={pago} onValueChange={(v) => { if (v) setPago(v as Pago); }}>
                <SelectTrigger className="w-full"><SelectValue labels={etiquetasPago} /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(etiquetasPago) as Pago[]).map((p) => <SelectItem key={p} value={p}>{etiquetasPago[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
          ) : null}
          {escenario === 'shopify_order_fulfilled' ? (
            <Campo label={t('assistant.probarGuia')} hint={t('assistant.probarGuiaHint')} className="col-span-2 sm:col-span-1">
              <Input value={guia} onChange={(e) => setGuia(e.target.value)} placeholder="360003112209570" className="text-base sm:text-sm" />
            </Campo>
          ) : null}
          {!token ? (
            <Campo label={t('assistant.probarTelefono')} hint={t('assistant.probarTelefonoHint')} className="col-span-2 sm:col-span-1">
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder={telefonoEjemplo || '+57 300 000 0000'} inputMode="tel" className="text-base sm:text-sm" />
            </Campo>
          ) : null}
        </div>

        {!token ? (
          <div className="border-border space-y-3 rounded-xl border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">{t('assistant.probarCompartir')}</p>
                <p className="text-muted-foreground text-xs">{t('assistant.probarCompartirHint')}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void compartir()} disabled={generandoLink} className="shrink-0 self-start sm:self-auto">
                {generandoLink ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
                {t('assistant.probarCopiarLink')}
              </Button>
            </div>
            {link ? (
              <div className="flex items-center gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 text-xs" />
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium"
                >
                  <ExternalLink className="size-3.5" />
                  {t('assistant.probarAbrirLink')}
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── El chat, como el teléfono del cliente ── */}
      <div ref={telefonoRef} className="scroll-mt-4 space-y-2">
        <MarcoDeTelefono
          titulo={nombreComercio || t('templates.yourBusiness')}
          subtitulo={t('assistant.probarEnLinea')}
          hiloRef={hiloRef}
          acciones={
            iniciado ? (
              <>
                <BotonDeTelefono
                  etiqueta={t('assistant.pruebasComentarioGeneral')}
                  onClick={() => setVerComentario((v) => !v)}
                  marcado={comentario.trim().length > 0}
                >
                  <NotebookPen className="size-4" />
                </BotonDeTelefono>
                <BotonDeTelefono etiqueta={t('assistant.probarReiniciar')} onClick={reiniciar}>
                  <RotateCcw className="size-4" />
                </BotonDeTelefono>
              </>
            ) : null
          }
          pie={
            <>
              {verComentario ? (
                <div className="space-y-1.5 bg-[#fff5c4] px-3 py-2">
                  <textarea
                    value={comentario}
                    rows={3}
                    maxLength={1000}
                    autoFocus
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder={t('assistant.pruebasComentarioPlaceholder')}
                    className="w-full resize-none rounded-md bg-white px-2.5 py-2 text-base text-[#111b21] outline-none placeholder:text-[#8696a0] sm:text-[13px]"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setVerComentario(false)}
                      className="rounded-full px-3 py-1 text-xs font-medium text-[#008069] hover:bg-white/60"
                    >
                      {t('assistant.pruebasListo')}
                    </button>
                  </div>
                </div>
              ) : null}
              {pendientes.length > 0 ? (
                <div className="flex flex-wrap items-center justify-center gap-2 bg-[#f0f2f5] px-3 py-2">
                  {pendientes.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => avanzar(p)}
                      disabled={enviando}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#008069] shadow-sm hover:bg-white/80 disabled:opacity-50"
                    >
                      <FastForward className="size-3.5" />
                      {t('assistant.probarPasaron', { n: p.espera.amount, unit: unidad(t, p.espera.unit, p.espera.amount) })}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <input
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
                  enterKeyHint="send"
                  className="h-10 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-[#111b21] outline-none placeholder:text-[#8696a0] disabled:opacity-60 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={enviando || cargando || !mensaje.trim()}
                  aria-label={t('assistant.probarEnviar')}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-[#00a884] text-white hover:bg-[#029b78] disabled:opacity-50"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </>
          }
        >
          {!iniciado ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-white/80 text-[#54656f] shadow-sm">
                <MessageSquareText className="size-5" />
              </div>
              <Button onClick={empezar} disabled={cargando} className="rounded-full bg-[#00a884] text-white hover:bg-[#029b78]">
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
            <Linea
              key={i}
              it={it}
              onBoton={(texto) => void enviar(texto)}
              feedback={marcas[i] ?? null}
              onFeedback={(m) => setMarcas((prev) => ({ ...prev, [i]: m }))}
            />
          ))}
        </MarcoDeTelefono>
        {onRevisar && sesionId && hayFeedback ? (
          <Button variant="outline" className="w-full sm:mx-auto sm:flex sm:max-w-[380px]" onClick={() => void revisar()} disabled={revisando}>
            {revisando ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {t('assistant.pruebasProponer')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Campo({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block min-w-0 space-y-1 ${className ?? ''}`}>
      <span className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">{label}</span>
      {children}
      {hint ? <span className="text-muted-foreground block text-[11px]">{hint}</span> : null}
    </label>
  );
}

interface ProductoDePrueba {
  id: string;
  title: string;
  /** Cada oferta es otro pedido: otro total y otra recompra. */
  ofertas: Array<{ units: number; label: string }>;
}

function leerProductos(
  productos: Array<{ id: string; title: string; allowed_offers?: unknown }>
): ProductoDePrueba[] {
  return productos.map((p) => ({
    id: p.id,
    title: p.title,
    ofertas: (Array.isArray(p.allowed_offers) ? p.allowed_offers : [])
      .map((o) => o as { units?: unknown; label?: unknown })
      .filter((o) => Number.isSafeInteger(Number(o?.units)) && Number(o?.units) > 0)
      .sort((a, b) => Number(a.units) - Number(b.units))
      .map((o) => ({
        units: Number(o.units),
        label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : `× ${Number(o.units)}`,
      })),
  }));
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

function ahora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Un id para la prueba. `randomUUID` sólo existe en https: el respaldo cubre el resto. */
function nuevoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  h[12] = '4';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function unidad(t: ReturnType<typeof useT>, unit: string, n: number): string {
  const claves: Record<string, [string, string]> = {
    seconds: ['assistant.probarSegundo', 'assistant.probarSegundos'],
    minutes: ['assistant.probarMinuto', 'assistant.probarMinutos'],
    hours: ['assistant.probarHora', 'assistant.probarHoras'],
    days: ['assistant.probarDia', 'assistant.probarDias'],
  };
  const par = claves[unit];
  return par ? t(par[n === 1 ? 0 : 1]) : unit;
}
