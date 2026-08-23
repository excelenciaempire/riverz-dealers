'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageText } from './message-text';
import { MessageMedia, type Media } from './message-media';

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

interface Settings {
  primary_color: string;
  position: 'right' | 'left';
  greeting: string;
  brand_name: string;
  avatar_url: string | null;
  require_email: boolean;
  auto_open_seconds: number;
  allow_uploads: boolean;
  ask_rating: boolean;
}

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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [email, setEmail] = useState('');
  const [identified, setIdentified] = useState(false);
  const [expired, setExpired] = useState(false);
  const [reanudando, setReanudando] = useState(false);
  // Si sirvió. Se pregunta una sola vez y sólo cuando ya hubo conversación de
  // verdad: pedirle una calificación a quien acaba de escribir "hola" no mide
  // nada y molesta.
  const [califico, setCalifico] = useState<null | boolean>(null);
  const [storeOrigin, setStoreOrigin] = useState<string | null>(null);

  const cursor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

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
          if (new URL(event.data.url).origin === event.origin) setStoreOrigin(event.origin);
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
    };
    window.addEventListener('message', onMessage);
    window.parent?.postMessage({ type: 'riverz:ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!session) return;
    // La configuración se pide una vez con el propio token: el cargador ya la
    // tiene, pero pasarla por el fragmento la dejaría en el historial.
    fetch('/api/widget/settings', { headers: { Authorization: `Bearer ${session}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.settings && setSettings(d.settings))
      .catch(() => {});
  }, [session]);

  // ── Sondeo ───────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!session) return;
    const url = cursor.current
      ? `/api/widget/messages?after=${encodeURIComponent(cursor.current)}`
      : '/api/widget/messages';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${session}` } });
    if (res.status === 401) {
      setExpired(true);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { messages: WireMessage[]; cursor: string | null };
    if (data.cursor) cursor.current = data.cursor;
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
    if (data.messages.some((m) => m.sender !== 'visitor')) setWaiting(false);
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
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !session || expired) return;
    const clientMessageId = crypto.randomUUID();
    setDraft('');
    // El mensaje aparece al instante: esperar el ida y vuelta hace sentir el
    // chat lento aunque el servidor conteste en 200 ms.
    setPending((prev) => [...prev, { id: clientMessageId, text }]);
    setWaiting(true);

    try {
      const res = await fetch('/api/widget/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ text, clientMessageId }),
      });
      if (res.status === 401) {
        setExpired(true);
        setWaiting(false);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { message_id: serverId } = (await res.json()) as { message_id?: string };
      if (serverId) {
        setPending((prev) => prev.map((p) => (p.id === clientMessageId ? { ...p, serverId } : p)));
      }
      poll().catch(() => {});
    } catch {
      setPending((prev) => prev.map((p) => (p.id === clientMessageId ? { ...p, failed: true } : p)));
      setWaiting(false);
    }
  }, [draft, session, expired, poll]);

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

  const identify = useCallback(async () => {
    const value = email.trim();
    if (!value || !session) return;
    await fetch('/api/widget/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ email: value }),
    }).catch(() => {});
    setIdentified(true);
  }, [email, session]);

  const color = settings?.primary_color ?? '#A3E635';
  const ink = useMemo(() => contrast(color), [color]);
  const needsEmail = Boolean(settings?.require_email) && !identified && messages.length === 0;

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
    <div className="flex h-full flex-col bg-white">
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
          aria-label="Cerrar"
          onClick={() => window.parent?.postMessage({ type: 'riverz:close' }, '*')}
          className="rounded-full p-1 opacity-70 transition hover:opacity-100"
          style={{ color: ink }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4">
        {settings?.greeting && timeline.length === 0 ? (
          <Bubble side="in">{settings.greeting}</Bubble>
        ) : null}

        {timeline.map((m) => (
          <Bubble
            key={m.id}
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
              />
            ) : null}
            {'media' in m && m.media ? <MessageMedia media={m.media} /> : null}
          </Bubble>
        ))}

        {waiting ? <Typing /> : null}

        {/* La calificación va acá abajo y no en un modal: interrumpir para
            preguntar "¿te sirvió?" es la forma más rápida de que la respuesta
            sea que no. Aparece cuando hubo ida y vuelta de verdad. */}
        {settings?.ask_rating !== false &&
        !waiting &&
        !expired &&
        messages.filter((m) => m.sender !== 'visitor').length >= 2 ? (
          <Rating valor={califico} onVotar={calificar} />
        ) : null}
      </div>

      {expired ? (
        // Recargar NO servía: el token viaja en el fragmento y se borra apenas
        // se lee, así que la recarga volvía sin sesión y dejaba un chat de
        // aspecto normal donde escribir no hacía absolutamente nada. La sesión
        // la emite el cargador, que es quien corre en el dominio de la tienda.
        <Notice
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
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
          />
          <button
            type="submit"
            className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ background: color, color: ink }}
          >
            Empezar
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
            title="Adjuntar"
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
            placeholder="Escribe tu mensaje"
            // Colores explícitos: el chat vive en un iframe que hereda el
            // layout raíz del panel, cuyo `text-foreground` cambia con el tema
            // del comercio. Sin fijarlos, el texto que escribe el cliente salía
            // casi blanco sobre blanco.
            className="max-h-32 flex-1 resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Enviar"
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

/** ¿Sirvió? Dos pulgares y nada más: cualquier cosa que pida escribir baja la
 *  respuesta a la décima parte, y lo que se necesita es el número. */
function Rating({
  valor,
  onVotar,
}: {
  valor: boolean | null;
  onVotar: (util: boolean) => void;
}) {
  if (valor !== null) {
    return (
      <p className="mt-3 text-center text-[11px] text-neutral-500">
        {valor ? 'Gracias por avisar.' : 'Gracias, se lo paso al equipo.'}
      </p>
    );
  }
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <span className="text-[11px] text-neutral-500">¿Te sirvió?</span>
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

function Notice({ onRetry, esperando }: { onRetry: () => void; esperando?: boolean }) {
  return (
    <div className="border-t border-neutral-200 p-3 text-center">
      <p className="text-sm text-neutral-600">La conversación caducó.</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={esperando}
        className="mt-1 text-sm font-semibold text-neutral-900 underline disabled:opacity-60"
      >
        {esperando ? 'Reanudando…' : 'Reanudar'}
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
