'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageText } from './message-text';

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
}

interface Settings {
  primary_color: string;
  position: 'right' | 'left';
  greeting: string;
  brand_name: string;
  avatar_url: string | null;
  require_email: boolean;
}

/** Sondeo con la pestaña a la vista, y con la pestaña de fondo. Alguien que
 *  dejó la tienda abierta en otra solapa no necesita 24 consultas por minuto,
 *  pero tampoco puede volver y encontrar el chat congelado. */
const POLL_ACTIVE_MS = 2500;
const POLL_HIDDEN_MS = 15000;

type Pending = { id: string; text: string; failed?: boolean };

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
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'riverz:context' && typeof event.data.url === 'string') {
        try {
          setStoreOrigin(new URL(event.data.url).origin);
        } catch {
          /* la tienda mandó algo que no es una URL */
        }
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
    // Un mensaje del visitante que vuelve del servidor ya no es optimista:
    // se descarta el eco local para no verlo dos veces.
    if (data.messages.some((m) => m.sender === 'visitor')) {
      setPending((prev) =>
        prev.filter((p) => !data.messages.some((m) => m.sender === 'visitor' && m.text === p.text)),
      );
    }
    if (data.messages.some((m) => m.sender !== 'visitor')) setWaiting(false);
  }, [session]);

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
      poll().catch(() => {});
    } catch {
      setPending((prev) => prev.map((p) => (p.id === clientMessageId ? { ...p, failed: true } : p)));
      setWaiting(false);
    }
  }, [draft, session, expired, poll]);

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
            <MessageText text={m.text} storeOrigin={storeOrigin} color={color} ink={ink} />
          </Bubble>
        ))}

        {waiting ? <Typing /> : null}
      </div>

      {expired ? (
        <Notice onRetry={() => window.location.reload()} />
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
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
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
            className="max-h-32 flex-1 resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
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

function Notice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-t border-neutral-200 p-3 text-center">
      <p className="text-sm text-neutral-600">La conversación caducó.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 text-sm font-semibold text-neutral-900 underline"
      >
        Reanudar
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
