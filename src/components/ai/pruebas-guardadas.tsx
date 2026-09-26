'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Link2,
  Loader2,
  MessageSquareText,
  Sparkles,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  etiquetaDeCanal,
  etiquetaDeEscenario,
  Linea,
  MarcoDeTelefono,
  type ItemChat,
  type MarcaDeFeedback,
} from '@/components/ai/chat-de-prueba';
import type { FeedbackGuardado, Propuestas } from '@/lib/ai/sesiones-de-prueba';
import { ConfirmarBorrado } from '@/components/ai/confirmar-borrado';
import { cn } from '@/lib/utils';

/**
 * Todas las pruebas de "Probar como cliente", como chats: las del equipo y
 * las del dueño de la marca por el link, con lo que se comentó y las mejoras
 * que aprobó el equipo de Riverz. Sólo para mirar: el feedback se guarda solo
 * desde el chat de prueba y las mejoras se aprueban en el panel de plataforma.
 * Borrar, una o todas, es sólo del equipo de Riverz.
 */

interface Resumen {
  id: string;
  origen: 'panel' | 'link';
  escenario: string | null;
  canal: string | null;
  primer_mensaje: string | null;
  producto: string | null;
  mensajes: number;
  feedback: { bien: number; mal: number; notas: number };
  con_propuestas: boolean;
  created_at: string;
  updated_at: string;
}

interface Detalle {
  id: string;
  origen: 'panel' | 'link';
  escenario: string | null;
  canal: string | null;
  detalle: { producto?: string | null } | null;
  items: ItemChat[];
  feedback: FeedbackGuardado[];
  propuestas: Propuestas | null;
  created_at: string;
}

export function PruebasGuardadas({
  elegida,
  onElegir,
  nombreComercio,
}: {
  elegida: string | null;
  onElegir: (id: string | null) => void;
  nombreComercio: string | null;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [lista, setLista] = useState<Resumen[] | null>(null);
  const [puedeBorrar, setPuedeBorrar] = useState(false);
  const [borrar, setBorrar] = useState<'todas' | string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/probar/sesiones', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as {
        sesiones?: Resumen[];
        puede_borrar?: boolean;
        error?: string;
      } | null;
      if (!res.ok) throw new Error(json?.error ?? '');
      setLista(json?.sesiones ?? []);
      setPuedeBorrar(json?.puede_borrar === true);
    } catch (err) {
      setLista([]);
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    }
  }, [t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function borrarAhora() {
    const todas = borrar === 'todas';
    const res = await fetchWithCsrf(todas ? '/api/ai/probar/sesiones' : `/api/ai/probar/sesiones/${borrar}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('assistant.probarFallo'));
      return;
    }
    if (todas || borrar === elegida) onElegir(null);
    setLista((prev) => (todas ? [] : (prev ?? []).filter((s) => s.id !== borrar)));
    if (todas) toast.success(t('assistant.pruebasBorradas'));
  }

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <ConfirmarBorrado
        abierto={borrar !== null}
        onCerrar={() => setBorrar(null)}
        titulo={
          borrar === 'todas'
            ? t('assistant.pruebasBorrarTodasTitulo', { n: lista?.length ?? 0 })
            : t('assistant.pruebasBorrar')
        }
        onBorrar={borrarAhora}
      />
      <div className={cn('min-w-0 space-y-2', elegida ? 'max-lg:hidden' : '')}>
        {puedeBorrar && lista && lista.length > 0 ? (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setBorrar('todas')}>
              <Trash2 className="size-3.5" />
              {t('assistant.pruebasBorrarTodas')}
            </Button>
          </div>
        ) : null}
        {lista === null ? (
          <div className="flex justify-center py-12">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : lista.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">{t('assistant.pruebasVacio')}</p>
        ) : (
          <ul className="max-h-[70dvh] space-y-1.5 overflow-y-auto pr-1">
            {lista.map((s) => (
              <li key={s.id}>
                <FilaDePrueba s={s} activa={s.id === elegida} onClick={() => onElegir(s.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={cn('min-w-0', elegida ? '' : 'max-lg:hidden')}>
        {elegida ? (
          <DetalleDePrueba
            key={elegida}
            id={elegida}
            nombreComercio={nombreComercio}
            onVolver={() => onElegir(null)}
            onBorrar={puedeBorrar ? () => setBorrar(elegida) : undefined}
          />
        ) : (
          <div className="text-muted-foreground flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm">
            {t('assistant.pruebasElegir')}
          </div>
        )}
      </div>
    </div>
  );
}

function FilaDePrueba({ s, activa, onClick }: { s: Resumen; activa: boolean; onClick: () => void }) {
  const t = useT();
  const format = useFormat();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-border hover:bg-muted/60 w-full space-y-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
        activa && 'border-primary bg-muted/60'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground truncate text-sm font-medium">
          {etiquetaDeEscenario(t, s.escenario)}
          <span className="text-muted-foreground font-normal"> · {etiquetaDeCanal(t, s.canal)}</span>
        </p>
        <span className="text-muted-foreground shrink-0 text-[11px]">
          {format.dateTime(s.updated_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {s.primer_mensaje ? <p className="text-muted-foreground truncate text-xs">{s.primer_mensaje}</p> : null}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
        {s.origen === 'link' ? (
          <span className="inline-flex items-center gap-1">
            <Link2 className="size-3" />
            {t('assistant.pruebasPorLink')}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <MessageSquareText className="size-3" />
          {s.mensajes}
        </span>
        {s.feedback.notas ? (
          <span className="inline-flex items-center gap-1">
            <NotebookPen className="size-3" />
            {s.feedback.notas}
          </span>
        ) : null}
        {s.con_propuestas ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            {t('assistant.pruebasConPropuestas')}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/**
 * Una prueba, para mirarla: el chat tal cual se vio, lo que se comentó y las
 * mejoras que el equipo de Riverz propuso y aplicó. Todos los que tienen
 * acceso a la cuenta la ven; nadie la edita desde acá.
 */
function DetalleDePrueba({
  id,
  nombreComercio,
  onVolver,
  onBorrar,
}: {
  id: string;
  nombreComercio: string | null;
  onVolver: () => void;
  onBorrar?: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const [sesion, setSesion] = useState<Detalle | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/ai/probar/sesiones/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as { sesion?: Detalle; error?: string } | null;
        if (!r.ok || !json?.sesion) throw new Error(json?.error ?? '');
        if (!cancelado) setSesion(json.sesion);
      })
      .catch((err) => {
        if (!cancelado) toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
      });
    return () => {
      cancelado = true;
    };
  }, [id, t]);

  if (!sesion) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  const porItem = new Map<number, MarcaDeFeedback>();
  for (const f of sesion.feedback ?? []) {
    if (f.item !== null) porItem.set(f.item, { voto: f.voto, nota: f.nota });
  }
  const general = (sesion.feedback ?? []).find((f) => f.item === null)?.nota ?? '';
  const reglas = sesion.propuestas?.reglas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onVolver} aria-label={t('common.back')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-medium">
            {etiquetaDeEscenario(t, sesion.escenario)} · {etiquetaDeCanal(t, sesion.canal)}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {format.dateTime(sesion.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {sesion.origen === 'link' ? ` · ${t('assistant.pruebasPorLink')}` : ''}
          </p>
        </div>
        {onBorrar ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={onBorrar}
            aria-label={t('assistant.pruebasBorrar')}
            title={t('assistant.pruebasBorrar')}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start">
        <div className="space-y-2">
          {general ? (
            <p className="rounded-lg bg-[#fff5c4] px-3 py-2 text-xs whitespace-pre-wrap text-[#54656f]">{general}</p>
          ) : null}
          <MarcoDeTelefono titulo={nombreComercio || t('templates.yourBusiness')} alto="h-[60dvh] min-h-[360px] sm:h-[min(560px,64vh)]">
            {sesion.items.map((it, i) => (
              <Linea key={i} it={it} feedback={porItem.get(i) ?? null} />
            ))}
          </MarcoDeTelefono>
        </div>

        <div className="min-w-0 space-y-3">
          <p className="text-foreground text-sm font-medium">{t('assistant.pruebasMejoras')}</p>
          {reglas.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('assistant.pruebasSinMejoras')}</p>
          ) : (
            reglas.map((r, i) => (
              <div key={i} className="border-border space-y-1.5 rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-foreground text-sm font-medium">{r.titulo}</p>
                  <Badge variant={r.aplicada ? 'default' : 'outline'}>
                    {r.aplicada ? t('assistant.pruebasAplicada') : t('assistant.pruebasEnRevision')}
                  </Badge>
                </div>
                {r.cuando ? <p className="text-muted-foreground text-xs">{r.cuando}</p> : null}
                <p className="text-foreground text-xs whitespace-pre-wrap">{r.hacer}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function TarjetaDeRegla({
  urlAplicar,
  indice,
  regla,
  agente,
  onAplicada,
}: {
  urlAplicar: string;
  indice: number;
  regla: Propuestas['reglas'][number];
  agente: string | null;
  onAplicada: (p: Propuestas) => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [titulo, setTitulo] = useState(regla.titulo);
  const [cuando, setCuando] = useState(regla.cuando);
  const [hacer, setHacer] = useState(regla.hacer);
  const [aplicando, setAplicando] = useState(false);

  async function aplicar() {
    setAplicando(true);
    try {
      const res = await fetchWithCsrf(urlAplicar, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indice, titulo, cuando, hacer }),
      });
      const json = (await res.json().catch(() => null)) as { propuestas?: Propuestas; error?: string } | null;
      if (!res.ok || !json?.propuestas) throw new Error(json?.error ?? '');
      onAplicada(json.propuestas);
      toast.success(t('assistant.pruebasAplicada'));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="border-border space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={regla.accion === 'crear' ? 'default' : 'outline'}>
          {regla.accion === 'crear' ? t('assistant.pruebasReglaNueva') : t('assistant.pruebasReglaEditada')}
        </Badge>
        {agente ? <span className="text-muted-foreground text-xs">{agente}</span> : null}
      </div>
      {regla.porque ? <p className="text-muted-foreground text-xs">{regla.porque}</p> : null}
      <Input value={titulo} maxLength={80} disabled={regla.aplicada} onChange={(e) => setTitulo(e.target.value)} className="text-base sm:text-sm" />
      <Input
        value={cuando}
        maxLength={500}
        disabled={regla.aplicada}
        placeholder={t('reglas.whenPlaceholder')}
        onChange={(e) => setCuando(e.target.value)}
        className="text-base sm:text-sm"
      />
      <Textarea value={hacer} maxLength={1500} disabled={regla.aplicada} onChange={(e) => setHacer(e.target.value)} />
      <div className="flex justify-end">
        {regla.aplicada ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" />
            {regla.automatica ? t('assistant.feedbackAplicadaSola') : t('assistant.pruebasAplicada')}
          </span>
        ) : (
          <Button size="sm" onClick={() => void aplicar()} disabled={aplicando || !titulo.trim() || !hacer.trim()}>
            {aplicando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t('assistant.pruebasAplicar')}
          </Button>
        )}
      </div>
    </div>
  );
}
