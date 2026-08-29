'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageText } from './message-text';
import { MessageMedia, type Media } from './message-media';
// La forma de la configuración se declara UNA vez, del lado del servidor que
// la emite. Estaba copiada a mano acá y ya se habían separado: el chat leía
// campos que el servidor no mandaba y al revés.
import type { WebchatSettings } from '@/lib/channels/webchat/config';

/**
 * El chat que ve quien visita la tienda.
 *
 * Vive dentro de un iframe, así que no comparte nada con el panel: ni sesión,
 * ni idioma del comercio, ni tokens de tema. Habla con tres endpoints públicos
 * y con el cargador de la tienda por `postMessage`.
 *
 * Cómo recibe las respuestas: sondeando. El tiempo real de Supabase filtra por
 * membresía del comercio, así que a un visitante anónimo no le llega nada por
 * ahí. El sondeo cuesta poco y tiene una ventaja que no se ve: la respuesta
 * del agente de IA y la que escribe una persona desde la bandeja llegan por el
 * MISMO camino, sin que el chat tenga que saber cuál es cuál.
 */

interface WireMessage {
  id: string;
  sender: 'visitor' | 'agent' | 'bot';
  text: string;
  created_at: string;
  agent_name?: string;
  media?: Media;
}


/**
 * El marco del chat, en los dos idiomas.
 *
 * No usa los catálogos del panel a propósito: esto lo lee el CLIENTE del
 * comercio, no el comercio. El panel sigue la cookie de quien administra; acá
 * el idioma lo decide el agente que atiende, que es el mismo que gobierna los
 * mensajes. Un diccionario de doce líneas mantiene el widget aislado, que es
 * la razón por la que vive en un iframe.
 */
const TEXTOS = {
  es: {
    adjuntar: 'Adjuntar',
    escribi: 'Escribe tu mensaje',
    enviar: 'Enviar',
    cerrar: 'Cerrar',
    caduco: 'La conversación caducó.',
    reanudar: 'Reanudar',
    reanudando: 'Reanudando…',
    sirvio: '¿Te sirvió?',
    gracias: 'Gracias por avisar.',
    graciasNo: 'Gracias, se lo paso al equipo.',
    empezar: 'Empezar',
    correo: 'tu@correo.com',
    telefono: 'Tu teléfono',
    agregar: 'Agregar',
    agregado: 'Agregado',
    agregando: 'Agregando…',
    pagar: 'Ir a pagar',
    yMas: (n: number) => `y ${n} más`,
    cantidad: 'Cantidad',
    menos: 'Quitar uno',
    mas: 'Sumar uno',
    opcion: 'Opción',
    sinStock: 'sin stock',
    ia: 'IA',
    equipo: 'Equipo',
    unaPersona: 'Ahora te atiende una persona',
    cerrada: 'Conversación cerrada',
    hablarPersona: 'Hablar con una persona',
    avisamos: 'Listo, avisamos al equipo.',
    queFalto: '¿Qué faltó?',
  },
  en: {
    adjuntar: 'Attach',
    escribi: 'Type your message',
    enviar: 'Send',
    cerrar: 'Close',
    caduco: 'This conversation expired.',
    reanudar: 'Resume',
    reanudando: 'Resuming…',
    sirvio: 'Did this help?',
    gracias: 'Thanks for letting us know.',
    graciasNo: 'Thanks — passing it to the team.',
    empezar: 'Start',
    correo: 'you@email.com',
    telefono: 'Your phone number',
    agregar: 'Add',
    agregado: 'Added',
    agregando: 'Adding…',
    pagar: 'Checkout',
    yMas: (n: number) => `and ${n} more`,
    cantidad: 'Quantity',
    menos: 'Remove one',
    mas: 'Add one',
    opcion: 'Option',
    sinStock: 'out of stock',
    ia: 'AI',
    equipo: 'Team',
    unaPersona: 'A person has joined the chat',
    cerrada: 'Conversation closed',
    hablarPersona: 'Talk to a person',
    avisamos: 'Done — the team has been notified.',
    queFalto: 'What was missing?',
  },
} as const;

/** La forma, no los literales: con `as const` el tipo del español exigía que
 *  el inglés dijera "Adjuntar". */
export type TextosChat = { [K in keyof (typeof TEXTOS)['es']]: (typeof TEXTOS)['es'][K] extends (
  n: number,
) => string
  ? (n: number) => string
  : string };

/** Sondeo con la pestaña a la vista, y con la pestaña de fondo. Alguien que
 *  dejó la tienda abierta en otra solapa no necesita 24 consultas por minuto,
 *  pero tampoco puede volver y encontrar el chat congelado. */
const POLL_ACTIVE_MS = 2500;
const POLL_HIDDEN_MS = 15000;

/** Cuánto se espera una respuesta antes de bajar los puntitos.
 *
 *  No es un adorno: sólo se apagaban cuando llegaba un mensaje que no era del
 *  visitante, así que TODO camino en el que la IA no contesta —el agente
 *  apagado, fuera de horario, un error del proveedor, y sobre todo el modo en
 *  que la respuesta queda esperando la aprobación de una persona— dejaba un
 *  "está escribiendo…" eterno. */
const WAIT_TIMEOUT_MS = 45_000;

/**
 * Un aviso corto cuando llega algo con el chat cerrado.
 *
 * Se sintetiza en vez de traer un archivo: un `.mp3` es un pedido más, una
 * regla más en la política de contenidos de la tienda y un asset que cachear.
 * Dos tonos cortos alcanzan para que alguien que dejó la pestaña de lado
 * levante la vista.
 *
 * Sólo suena con el panel cerrado. Un sonido por cada burbuja de una respuesta
 * que la persona está leyendo no avisa nada: molesta.
 */
function sonar() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const ahora = ctx.currentTime;
    for (const [i, hz] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      vol.gain.setValueAtTime(0.0001, ahora + i * 0.12);
      vol.gain.exponentialRampToValueAtTime(0.08, ahora + i * 0.12 + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, ahora + i * 0.12 + 0.1);
      osc.connect(vol).connect(ctx.destination);
      osc.start(ahora + i * 0.12);
      osc.stop(ahora + i * 0.12 + 0.12);
    }
    setTimeout(() => void ctx.close().catch(() => {}), 600);
  } catch {
    // El navegador puede negar el audio sin gesto previo. No es un error que
    // le importe a nadie: el globo del lanzador ya avisó.
  }
}

type Pending = {
  id: string;
  text: string;
  failed?: boolean;
  media?: Media;
  /** Id que le dio el servidor. Es con lo que se descarta el eco local. */
  serverId?: string;
  /** Miniatura local que hay que liberar cuando la burbuja se va. */
  objectUrl?: string;
};

export function ChatApp() {
  const [session, setSession] = useState<string | null>(null);
  const [settings, setSettings] = useState<WebchatSettings | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [identified, setIdentified] = useState(false);
  const [expired, setExpired] = useState(false);
  const [reanudando, setReanudando] = useState(false);
  // Si sirvió. Se pregunta una sola vez y sólo cuando ya hubo conversación de
  // verdad: pedirle una calificación a quien acaba de escribir "hola" no mide
  // nada y molesta.
  const [califico, setCalifico] = useState<null | boolean>(null);
  const [comentario, setComentario] = useState('');
  const [comentarioEnviado, setComentarioEnviado] = useState(false);
  /** Estado de la conversación tal como lo ve la bandeja. 'pending' significa
   *  que ya hay alguien en camino, venga de donde venga el escalamiento. */
  const [estado, setEstado] = useState<'open' | 'pending' | 'closed'>('open');
  const [pidiendoPersona, setPidiendoPersona] = useState(false);
  const [storeOrigin, setStoreOrigin] = useState<string | null>(null);
  const T = TEXTOS[settings?.locale === 'en' ? 'en' : 'es'];

  const cursor = useRef<string | null>(null);
  // Hasta cuándo ya vimos ediciones. El servidor manda su propio reloj y se
  // lo devolvemos: si el mensaje viejo cambia, vuelve por acá y no por el
  // cursor, que sólo avanza hacia adelante.
  const editCursor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  // ¿El visitante está mirando el chat? Arranca en true porque este componente
  // sólo se monta cuando el contenedor abre el iframe por primera vez; el
  // cargador confirma el estado real al recibir `riverz:ready`.
  const abierto = useRef(true);
  const noLeidos = useRef(0);
  /** Lo que el visitante dio ANTES de escribir, cuando todavía no existía el
   *  contacto donde guardarlo. Se reintenta con el primer mensaje. */
  const datosPendientes = useRef<{ email?: string; phone?: string } | null>(null);
  /** Qué página de la tienda está mirando. La manda el cargador, que es el
   *  único que la ve: dentro del iframe `location` es la nuestra. Va en un ref
   *  y no en el estado porque sólo la lee el envío. */
  const pagina = useRef<{ url: string; title: string } | null>(null);
  /** Si ya se le avisó a Meta que esta persona abrió conversación. `Contact`
   *  marca que el hilo empezó, no cada mensaje: quien vuelve a un hilo que ya
   *  existe no vuelve a contarse. */
  const contactoAvisado = useRef(false);

  // ── Arranque ─────────────────────────────────────────────────
  useEffect(() => {
    // El token viene en el fragmento: no viaja al servidor, no queda en logs
    // ni se filtra por el Referer al navegar.
    const match = /(?:^|[#&])s=([^&]+)/.exec(window.location.hash);
    if (match) setSession(decodeURIComponent(match[1]));
    // Se borra de la barra apenas se lee.
    if (match) history.replaceState(null, '', window.location.pathname);

    const onMessage = (event: MessageEvent) => {
      // Sólo del contenedor, y sólo si el origen que dice ser es el que el
      // navegador ve. `storeOrigin` es la puerta que decide si un enlace se
      // dibuja como un botón de compra de la tienda: cualquier página que
      // embeba este iframe podía anunciarse como otra y hacer que un enlace
      // suyo pareciera un checkout del comercio.
      if (event.source !== window.parent) return;
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'riverz:context' && typeof event.data.url === 'string') {
        try {
          if (new URL(event.data.url).origin === event.origin) {
            setStoreOrigin(event.origin);
            // La página en la que está parada la persona. Se guarda sólo
            // cuando el origen coincide, por lo mismo que `storeOrigin`: es
            // un dato que después el agente lee como cierto.
            pagina.current = {
              url: String(event.data.url).slice(0, 500),
              title:
                typeof event.data.title === 'string'
                  ? event.data.title.slice(0, 200)
                  : '',
            };
          }
        } catch {
          /* la tienda mandó algo que no es una URL */
        }
      }
      // Sesión nueva tras vencer: la emite el cargador, que es el único que
      // corre en el dominio de la tienda.
      if (event.data.type === 'riverz:session') {
        if (typeof event.data.token === 'string' && event.data.token) {
          cursor.current = null;
          setMessages([]);
          setSession(event.data.token);
          setExpired(false);
        }
        setReanudando(false);
      }
      // Abierto o cerrado. El iframe sigue montado con el chat cerrado —así el
      // hilo no se pierde al minimizar— así que sin esto no hay forma de saber
      // si el visitante está mirando lo que llega.
      if (event.data.type === 'riverz:opened') {
        abierto.current = true;
        noLeidos.current = 0;
        window.parent?.postMessage({ type: 'riverz:unread', count: 0 }, '*');
        // El foco entra al cuadro de escribir. Sin esto, quien abre el chat
        // con el teclado queda con el foco en la página de la tienda y tiene
        // que tabular a ciegas dentro de un iframe para poder escribir.
        setTimeout(() => composer.current?.focus(), 60);
      }
      if (event.data.type === 'riverz:closed') abierto.current = false;
    };
    // Escape cierra, como cualquier panel que se abre encima. El chat corre en
    // un iframe, así que la tecla la recibe él y no la tienda: sin esto no
    // había forma de cerrarlo sin apuntar con el mouse a la cruz.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.parent?.postMessage({ type: 'riverz:close' }, '*');
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    window.parent?.postMessage({ type: 'riverz:ready' }, '*');
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    // La configuración se pide una vez con el propio token: el cargador ya la
    // tiene, pero pasarla por el fragmento la dejaría en el historial.
    fetch('/api/widget/settings', { headers: { Authorization: `Bearer ${session}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.settings && setSettings(d.settings as WebchatSettings))
      .catch(() => {});
  }, [session]);

  // ── Sondeo ───────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!session) return;
    const params = new URLSearchParams();
    if (cursor.current) params.set('after', cursor.current);
    if (editCursor.current) params.set('edited_after', editCursor.current);
    const qs = params.toString();
    const url = qs ? `/api/widget/messages?${qs}` : '/api/widget/messages';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session}` } });
    if (res.status === 401) {
      setExpired(true);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: WireMessage[];
      edits?: Array<{ id: string; text: string }>;
      now?: string;
      cursor: string | null;
      status?: string;
    };
    // Un sondeo sin cursor es el historial: si ya había mensajes del visitante,
    // este hilo no empieza hoy y Meta ya se enteró.
    if (!cursor.current && data.messages.some((m) => m.sender === 'visitor')) {
      contactoAvisado.current = true;
    }
    if (data.cursor) cursor.current = data.cursor;
    // El comercio corrigió algo que el visitante ya tiene en pantalla.
    if (data.edits?.length) {
      const porId = new Map(data.edits.map((e) => [e.id, e.text]));
      setMessages((prev) =>
        prev.map((m) => (porId.has(m.id) ? { ...m, text: porId.get(m.id) as string } : m)),
      );
    }
    if (data.now) editCursor.current = data.now;
    // El servidor manda el estado de la conversación en cada sondeo y el chat
    // lo descartaba: quien volvía a un hilo que el comercio ya había cerrado
    // veía una caja de texto idéntica a la de una conversación viva. Y sin
    // esto, el botón de pedir una persona reaparecía en cada recarga aunque el
    // pedido ya estuviera hecho.
    if (data.status === 'closed' || data.status === 'pending' || data.status === 'open') {
      setEstado(data.status);
    }
    if (!data.messages.length) return;

    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = data.messages.filter((m) => !seen.has(m.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    // Un mensaje del visitante que vuelve del servidor ya no es optimista: se
    // descarta el eco local para no verlo dos veces.
    //
    // Por ID y no por texto. Comparando el texto, mandar "hola" dos veces
    // —o dos archivos seguidos, que llegan los dos con el texto vacío— borraba
    // las dos burbujas con el primer eco y la segunda reaparecía un ciclo
    // después, saltando de lugar.
    if (data.messages.some((m) => m.sender === 'visitor')) {
      const llegaron = new Set(data.messages.map((m) => m.id));
      setPending((prev) => {
        const quedan = prev.filter((p) => !p.serverId || !llegaron.has(p.serverId));
        // La miniatura local ya no se muestra: sin liberarla, cada foto de una
        // conversación de soporte quedaba en memoria hasta cerrar la pestaña.
        for (const p of prev) {
          if (p.objectUrl && !quedan.includes(p)) URL.revokeObjectURL(p.objectUrl);
        }
        return quedan.length === prev.length ? prev : quedan;
      });
    }
    const deOtros = data.messages.filter((m) => m.sender !== 'visitor');
    if (deOtros.length) setWaiting(false);

    // La burbuja del lanzador. El contenedor sabe dibujarla desde el principio
    // —tiene el nodo y el manejador— pero nadie le mandaba nunca el número, así
    // que era imposible que apareciera: quien cerraba el chat y seguía
    // navegando no se enteraba de que le habían contestado.
    if (deOtros.length && !abierto.current) {
      noLeidos.current += deOtros.length;
      window.parent?.postMessage(
        { type: 'riverz:unread', count: noLeidos.current },
        '*',
      );
      sonar();
    }
  }, [session]);

  // Los puntitos no pueden quedarse para siempre: hay caminos legítimos en los
  // que no llega ninguna respuesta.
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(false), WAIT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  useEffect(() => {
    if (!session || expired) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      poll()
        .catch(() => {})
        .finally(() => {
          if (stopped) return;
          timer = setTimeout(loop, document.hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS);
        });
    };
    loop();
    // Volver a la pestaña trae lo que pasó mientras tanto sin esperar el ciclo
    // largo.
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        loop();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session, expired, poll]);

  // Autoscroll al final salvo que la persona esté leyendo hacia arriba.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, pending, waiting]);

  // ── Enviar ───────────────────────────────────────────────────
  /** Manda un texto. Lo usa el cuadro de escritura y también las preguntas
   *  sugeridas, que son un mensaje del visitante como cualquier otro. */
  const enviarTexto = useCallback(async (crudo: string) => {
    const text = crudo.trim();
    if (!text || !session || expired) return;
    const clientMessageId = crypto.randomUUID();
    // El mensaje aparece al instante: esperar el ida y vuelta hace sentir el
    // chat lento aunque el servidor conteste en 200 ms.
    setPending((prev) => [...prev, { id: clientMessageId, text }]);
    setWaiting(true);

    try {
      const res = await fetch('/api/widget/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({
          text,
          clientMessageId,
          // Dónde está parada la persona cuando escribe. Es lo que convierte
          // "¿viene en negro?" en una pregunta contestable sin repreguntar.
          ...(pagina.current ? { page: pagina.current } : {}),
        }),
      });
      if (res.status === 401) {
        setExpired(true);
        setWaiting(false);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { message_id: serverId, pixel_event_id: pixelId } = (await res.json()) as {
        message_id?: string;
        pixel_event_id?: string;
      };
      if (serverId) {
        setPending((prev) => prev.map((p) => (p.id === clientMessageId ? { ...p, serverId } : p)));
      }
      // Meta se entera de que esta persona empezó a conversar.
      //
      // Sólo en el PRIMER mensaje del hilo: `Contact` marca que se abrió la
      // conversación, no cada cosa que se escribe dentro. El píxel vive en la
      // página de la tienda, así que lo dispara el cargador; el mismo evento
      // sale además desde el servidor y los dos llevan el mismo id, que es lo
      // que hace que Meta cuente uno solo.
      if (pixelId && !contactoAvisado.current) {
        contactoAvisado.current = true;
        window.parent?.postMessage(
          { type: 'riverz:pixel', event: 'Contact', eventId: pixelId },
          '*',
        );
      }
      // Ahora sí existe el contacto: acá se guardan los datos que el visitante
      // dio antes de escribir. Sin bloquear el envío — el mensaje ya salió.
      if (datosPendientes.current) {
        const datos = datosPendientes.current;
        datosPendientes.current = null;
        void fetch('/api/widget/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
          body: JSON.stringify(datos),
        }).catch(() => {});
      }
      poll().catch(() => {});
    } catch {
      setPending((prev) => prev.map((p) => (p.id === clientMessageId ? { ...p, failed: true } : p)));
      setWaiting(false);
    }
  }, [session, expired, poll]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void enviarTexto(text);
  }, [draft, enviarTexto]);

  /** El visitante adjunta una foto o un comprobante. */
  const adjuntar = useCallback(
    async (file: File) => {
      if (!session || expired) return;
      const clientMessageId = crypto.randomUUID();
      // La miniatura local aparece al instante; el objeto se libera cuando el
      // mensaje real llega por el sondeo y reemplaza al optimista.
      const previo = URL.createObjectURL(file);
      setPending((prev) => [
        ...prev,
        {
          id: clientMessageId,
          text: '',
          objectUrl: previo,
          media: { url: previo, kind: file.type.startsWith('image/') ? 'image' : 'file', name: file.name },
        },
      ]);
      setWaiting(true);

      const body = new FormData();
      body.append('file', file);
      body.append('clientMessageId', clientMessageId);
      try {
        const res = await fetch('/api/widget/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session}` },
          body,
        });
        if (res.status === 401) {
          setExpired(true);
          setWaiting(false);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const { message_id: serverId } = (await res.json()) as { message_id?: string | null };
        if (serverId) {
          setPending((prev) => prev.map((p) => (p.id === clientMessageId ? { ...p, serverId } : p)));
        }
        poll().catch(() => {});
      } catch {
        setPending((prev) =>
          prev.map((p) => (p.id === clientMessageId ? { ...p, failed: true } : p)),
        );
        setWaiting(false);
      }
    },
    [session, expired, poll],
  );

  const calificar = useCallback(
    async (util: boolean) => {
      if (!session || califico !== null) return;
      // Se pinta antes de que conteste el servidor: es un gesto de un toque y
      // esperar el ida y vuelta lo hace sentir roto.
      setCalifico(util);
      await fetch('/api/widget/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ util }),
      }).catch(() => {});
    },
    [session, califico],
  );

  /** El motivo del pulgar abajo, cuando la persona quiere darlo. */
  const enviarComentario = useCallback(async () => {
    const texto = comentario.trim();
    if (!texto || !session || comentarioEnviado) return;
    setComentarioEnviado(true);
    await fetch('/api/widget/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ util: false, comentario: texto }),
    }).catch(() => {});
  }, [comentario, session, comentarioEnviado]);

  /**
   * "Quiero hablar con una persona".
   *
   * Se pinta como hecho antes de que conteste el servidor: quien aprieta esto
   * ya está incómodo, y un botón que no reacciona durante medio segundo es
   * exactamente lo que no hay que hacerle. El estado real llega en el próximo
   * sondeo ('pending') y manda sobre esta suposición.
   */
  const pedirPersona = useCallback(async () => {
    if (!session || pidiendoPersona || estado === 'pending') return;
    setPidiendoPersona(true);
    const res = await fetch('/api/widget/handoff', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session}` },
    }).catch(() => null);
    if (!res?.ok) setPidiendoPersona(false);
  }, [session, pidiendoPersona, estado]);

  const identify = useCallback(async () => {
    const datos: { email?: string; phone?: string } = {};
    if (email.trim()) datos.email = email.trim();
    if (telefono.trim()) datos.phone = telefono.trim();
    if (!session || (!datos.email && !datos.phone)) return;
    const res = await fetch('/api/widget/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify(datos),
    }).catch(() => null);
    // Con "pedir datos antes de escribir", este es SIEMPRE el primer paso:
    // todavía no hay contacto —nadie escribió— así que el servidor no tiene
    // dónde guardarlos y contesta `linked:false`. El comercio configuró que se
    // los pidan y se perdían igual. Se recuerdan y se vuelven a mandar apenas
    // el primer mensaje cree el contacto: no se crea una fila para quien sólo
    // abrió el widget, y el ajuste hace lo que promete.
    const json = (await res?.json().catch(() => null)) as { linked?: boolean } | null;
    datosPendientes.current = json?.linked === false ? datos : null;
    setIdentified(true);
  }, [email, telefono, session]);

  const color = settings?.primary_color ?? '#A3E635';
  const ink = useMemo(() => contrast(color), [color]);

  /**
   * Qué se pide antes de escribir. `require_email` es la forma vieja del mismo
   * ajuste y sigue llegando en las configuraciones ya guardadas.
   */
  const pide = settings?.require_contact ?? (settings?.require_email ? 'email' : 'off');
  const pideCorreo = pide === 'email' || pide === 'both';
  const pideTelefono = pide === 'phone' || pide === 'both';
  const needsEmail = (pideCorreo || pideTelefono) && !identified && messages.length === 0;

  /**
   * Quién firma un mensaje entrante.
   *
   * El cable ya traía `sender: 'bot'|'agent'` y `agent_name`, y el chat los
   * plegaba en una sola burbuja gris: del lado del visitante era imposible
   * saber si le contestaba un programa o una persona. Decirlo es lo que hace
   * que la respuesta de la IA se lea como una respuesta y no como un engaño.
   */
  const autorDe = useCallback(
    (m: { sender: string; agent_name?: string }): string | null => {
      if (m.sender === 'visitor') return null;
      if (m.sender === 'bot') return settings?.brand_name || T.equipo;
      return m.agent_name || T.equipo;
    },
    [settings?.brand_name, T],
  );

  const timeline = useMemo(
    () => [
      ...messages,
      ...pending.map((p) => ({
        id: p.id,
        sender: 'visitor' as const,
        text: p.text,
        created_at: '',
        failed: p.failed,
        media: p.media,
      })),
    ],
    [messages, pending],
  );

  return (
    <div
      className="flex h-full flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label={settings?.brand_name || T.equipo}
    >
      <header
        className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3"
        style={{ background: color }}
      >
        {settings?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={settings.avatar_url}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: ink }}>
            {settings?.brand_name ?? ''}
          </p>
        </div>
        <button
          type="button"
          aria-label={T.cerrar}
          onClick={() => window.parent?.postMessage({ type: 'riverz:close' }, '*')}
          className="rounded-full p-1 opacity-70 transition hover:opacity-100"
          style={{ color: ink }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* `aria-live` para que un lector de pantalla anuncie lo que llega: sin
          esto, una respuesta que aparece sola es invisible para quien no ve. */}
      <div ref={scroller} aria-live="polite" className="flex-1 overflow-y-auto px-4 py-4">
        {settings?.greeting && timeline.length === 0 ? (
          <>
            <Autor nombre={settings.brand_name || T.equipo} ia T={T} />
            <Bubble side="in">{settings.greeting}</Bubble>
          </>
        ) : null}

        {/* Preguntas sugeridas. Un chat vacío con un cursor parpadeando le
            pide a la persona que invente la pregunta, y la mayoría no la
            inventa: se va. Desaparecen apenas hay conversación —son un
            arranque, no un menú— y lo que mandan es un mensaje normal. */}
        {timeline.length === 0 && !needsEmail && (settings?.quick_replies?.length ?? 0) > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings!.quick_replies!.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void enviarTexto(q)}
                className="rounded-full border px-3 py-1.5 text-xs transition hover:bg-neutral-50"
                style={{ borderColor: color, color: '#374151' }}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}

        {timeline.map((m, i) => {
          const previo = i > 0 ? timeline[i - 1] : null;
          const autor = autorDe(m);
          const autorPrevio = previo ? autorDe(previo) : null;
          // La firma se repite sólo cuando cambia quien escribe: ponerla en
          // cada burbuja convierte una respuesta partida en tres en una lista
          // de nombres.
          const firma = autor !== null && autor !== autorPrevio;
          // El momento en que el hilo deja de ser un bot. Es la única
          // transición que el visitante necesita ver escrita.
          const traspaso =
            m.sender === 'agent' && previo?.sender === 'bot';
          return (
            <div key={m.id}>
              {traspaso ? (
                <p className="my-3 text-center text-[11px] text-neutral-500">{T.unaPersona}</p>
              ) : null}
              {firma ? <Autor nombre={autor} ia={m.sender === 'bot'} T={T} /> : null}
              <Bubble
                side={m.sender === 'visitor' ? 'out' : 'in'}
                color={color}
                ink={ink}
                failed={'failed' in m ? Boolean(m.failed) : false}
              >
                {m.text ? (
                  <MessageText
                    text={m.text}
                    storeOrigin={storeOrigin}
                    color={color}
                    ink={ink}
                    session={session}
                    T={T}
                  />
                ) : null}
                {'media' in m && m.media ? <MessageMedia media={m.media} /> : null}
              </Bubble>
            </div>
          );
        })}

        {waiting ? <Typing /> : null}

        {estado === 'closed' && !waiting ? (
          <p className="my-3 text-center text-[11px] text-neutral-400">{T.cerrada}</p>
        ) : null}

        {/* La calificación va acá abajo y no en un modal: interrumpir para
            preguntar "¿te sirvió?" es la forma más rápida de que la respuesta
            sea que no. Aparece cuando hubo ida y vuelta de verdad. */}
        {settings?.ask_rating !== false &&
        !waiting &&
        !expired &&
        messages.filter((m) => m.sender !== 'visitor').length >= 2 ? (
          <Rating
            valor={califico}
            onVotar={calificar}
            comentario={comentario}
            onComentario={setComentario}
            onEnviarComentario={enviarComentario}
            comentarioEnviado={comentarioEnviado}
            T={T}
          />
        ) : null}

        {/* Pedir una persona. Va al final del hilo y sólo después de que el
            visitante escribió: ofrecerlo antes de la primera palabra es
            anunciar que el chat no sirve. Cuando el hilo ya está esperando a
            alguien —lo pidió él, o escaló solo— el botón deja lugar al aviso. */}
        {!expired && estado !== 'closed' && messages.some((m) => m.sender === 'visitor') ? (
          estado === 'pending' || pidiendoPersona ? (
            <p className="mt-3 text-center text-[11px] text-neutral-500">{T.avisamos}</p>
          ) : (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={pedirPersona}
                className="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 transition hover:bg-neutral-50"
              >
                {T.hablarPersona}
              </button>
            </div>
          )
        ) : null}
      </div>

      {/* Fuera de horario. Va arriba del cuadro de texto y NO lo bloquea: la
          persona igual puede escribir y el mensaje queda esperando. Cerrarle el
          chat sería perder la consulta que ya venía a hacer. */}
      {!expired && settings?.offline_message ? (
        <p className="border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-center text-[11px] text-neutral-600">
          {settings.offline_message}
        </p>
      ) : null}

      {expired ? (
        // Recargar NO servía: el token viaja en el fragmento y se borra apenas
        // se lee, así que la recarga volvía sin sesión y dejaba un chat de
        // aspecto normal donde escribir no hacía absolutamente nada. La sesión
        // la emite el cargador, que es quien corre en el dominio de la tienda.
        <Notice
          T={T}
          esperando={reanudando}
          onRetry={() => {
            setReanudando(true);
            window.parent?.postMessage({ type: 'riverz:resume' }, '*');
          }}
        />
      ) : needsEmail ? (
        <form
          className="border-t border-neutral-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            identify();
          }}
        >
          {pideCorreo ? (
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={T.correo}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
            />
          ) : null}
          {pideTelefono ? (
            <input
              type="tel"
              required
              inputMode="tel"
              // Ocho dígitos como mínimo, escritos como la persona quiera. Sin
              // esto `type="tel"` acepta cualquier cosa y lo que queda guardado
              // es un teléfono que no sirve para llamar ni para unir nada.
              pattern="(?:[^0-9]*[0-9]){8,}[^0-9]*"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder={T.telefono}
              className={`w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500${pideCorreo ? ' mt-2' : ''}`}
            />
          ) : null}
          <button
            type="submit"
            className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: color, color: ink }}
          >
            {T.empezar}
          </button>
        </form>
      ) : (
        <form
          className="flex items-end gap-2 border-t border-neutral-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {/* El clip se esconde entero cuando el comercio no quiere archivos.
              Dejarlo y rechazar el archivo después sería ofrecer algo que no
              funciona, que es peor que no ofrecerlo. */}
          {settings?.allow_uploads !== false ? (
          <label
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800"
            title={T.adjuntar}
          >
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Se limpia el input para que elegir DOS VECES el mismo archivo
                // vuelva a disparar el evento; si no, el segundo intento —el
                // típico tras un fallo de red— no hacía nada.
                e.target.value = '';
                if (f) adjuntar(f);
              }}
            />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3.33 3.33 0 0 1 4.71 4.71l-9.19 9.19a1.67 1.67 0 0 1-2.36-2.36l8.49-8.48" />
            </svg>
          </label>
          ) : null}
          <textarea
            ref={composer}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda, Shift+Enter hace salto: es lo que espera quien
              // escribió en cualquier chat alguna vez.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={T.escribi}
            // Colores explícitos: el chat vive en un iframe que hereda el
            // layout raíz del panel, cuyo `text-foreground` cambia con el tema
            // del comercio. Sin fijarlos, el texto que escribe el cliente salía
            // casi blanco sobre blanco.
            className="max-h-32 flex-1 resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label={T.enviar}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition disabled:opacity-40"
            style={{ background: color, color: ink }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12l16-8-6 16-2-6-8-2z" />
            </svg>
          </button>
        </form>
      )}
    </div>
  );
}

function Bubble({
  side,
  color,
  ink,
  failed,
  children,
}: {
  side: 'in' | 'out';
  color?: string;
  ink?: string;
  failed?: boolean;
  children: React.ReactNode;
}) {
  const out = side === 'out';
  return (
    <div className={`mb-2 flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
          out ? 'rounded-br-sm' : 'rounded-bl-sm bg-neutral-100 text-neutral-900'
        } ${failed ? 'opacity-50' : ''}`}
        style={out ? { background: color, color: ink } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** La firma de quien contesta, arriba de su primera burbuja. */
function Autor({ nombre, ia, T }: { nombre: string; ia?: boolean; T: TextosChat }) {
  return (
    <p className="mb-1 ml-1 flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
      <span className="truncate">{nombre}</span>
      {ia ? (
        <span className="rounded bg-neutral-200 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
          {T.ia}
        </span>
      ) : null}
    </p>
  );
}

function Typing() {
  return (
    <div className="mb-2 flex justify-start">
      <div className="flex gap-1 rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * ¿Sirvió? Dos pulgares, y el motivo sólo a quien dijo que no.
 *
 * Pedir el texto ANTES del voto baja la respuesta a la décima parte, así que
 * el número se toma primero y la caja aparece después. Y sólo tras el pulgar
 * abajo: al que quedó conforme no hay nada que preguntarle, y el comentario
 * que sirve para arreglar algo es el otro. El servidor ya guardaba
 * `csat_comment` y nadie se lo pedía a nadie.
 */
function Rating({
  valor,
  onVotar,
  comentario,
  onComentario,
  onEnviarComentario,
  comentarioEnviado,
  T,
}: {
  valor: boolean | null;
  onVotar: (util: boolean) => void;
  comentario: string;
  onComentario: (v: string) => void;
  onEnviarComentario: () => void;
  comentarioEnviado: boolean;
  T: TextosChat;
}) {
  if (valor !== null) {
    return (
      <div className="mt-3">
        <p className="text-center text-[11px] text-neutral-500">
          {valor ? T.gracias : T.graciasNo}
        </p>
        {valor === false && !comentarioEnviado ? (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onEnviarComentario();
            }}
          >
            <input
              value={comentario}
              onChange={(e) => onComentario(e.target.value)}
              maxLength={500}
              placeholder={T.queFalto}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={!comentario.trim()}
              className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
            >
              {T.enviar}
            </button>
          </form>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <span className="text-[11px] text-neutral-500">{T.sirvio}</span>
      {[true, false].map((util) => (
        <button
          key={String(util)}
          type="button"
          onClick={() => onVotar(util)}
          aria-label={util ? 'Sí' : 'No'}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition hover:bg-neutral-50"
        >
          {util ? '👍' : '👎'}
        </button>
      ))}
    </div>
  );
}

function Notice({
  onRetry,
  esperando,
  T,
}: {
  onRetry: () => void;
  esperando?: boolean;
  T: TextosChat;
}) {
  return (
    <div className="border-t border-neutral-200 p-3 text-center">
      <p className="text-sm text-neutral-600">{T.caduco}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={esperando}
        className="mt-1 text-sm font-semibold text-neutral-900 underline disabled:opacity-60"
      >
        {esperando ? T.reanudando : T.reanudar}
      </button>
    </div>
  );
}

/** Negro o blanco sobre el color de marca, para que el texto se lea. */
function contrast(hex: string): string {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return '#111827';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
}
