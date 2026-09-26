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
  ThumbsDown,
  ThumbsUp,
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
import { cn } from '@/lib/utils';

/**
 * Todas las pruebas de "Probar como cliente", como chats: las del equipo y
 * las del dueño de la marca por el link. Cada una se revisa tal cual se vio,
 * con lo que se marcó en cada respuesta, y ese feedback se convierte en
 * reglas que se revisan y se aplican con un clic.
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
  const [lista, setLista] = useState<Resumen[] | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/probar/sesiones', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as { sesiones?: Resumen[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? '');
      setLista(json?.sesiones ?? []);
    } catch (err) {
      setLista([]);
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    }
  }, [t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className={cn('min-w-0 space-y-2', elegida ? 'max-lg:hidden' : '')}>
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
            onCambio={() => void cargar()}
            onBorrada={() => {
              onElegir(null);
              setLista((prev) => (prev ?? []).filter((s) => s.id !== elegida));
            }}
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
        {s.feedback.bien ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <ThumbsUp className="size-3" />
            {s.feedback.bien}
          </span>
        ) : null}
        {s.feedback.mal ? (
          <span className="text-destructive inline-flex items-center gap-1">
            <ThumbsDown className="size-3" />
            {s.feedback.mal}
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

function DetalleDePrueba({
  id,
  nombreComercio,
  onVolver,
  onCambio,
  onBorrada,
}: {
  id: string;
  nombreComercio: string | null;
  onVolver: () => void;
  onCambio: () => void;
  onBorrada: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [sesion, setSesion] = useState<Detalle | null>(null);
  const [agentes, setAgentes] = useState<Array<{ id: string; name: string }>>([]);
  const [proponiendo, setProponiendo] = useState(false);
  const [borrando, setBorrando] = useState(false);
  /** El comentario general mientras se escribe: cuenta como feedback aunque no se haya guardado. */
  const [borradorGeneral, setBorradorGeneral] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/ai/probar/sesiones/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as {
          sesion?: Detalle;
          agentes?: Array<{ id: string; name: string }>;
          error?: string;
        } | null;
        if (!r.ok || !json?.sesion) throw new Error(json?.error ?? '');
        if (cancelado) return;
        setSesion(json.sesion);
        setAgentes(json.agentes ?? []);
      })
      .catch((err) => {
        if (!cancelado) toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
      });
    return () => {
      cancelado = true;
    };
  }, [id, t]);

  async function proponer() {
    setProponiendo(true);
    try {
      // Lo escrito y sin guardar va primero: la propuesta lee el feedback guardado.
      if (borradorGeneral !== null && borradorGeneral.trim() !== general.trim()) {
        const ok = await marcar(null, { voto: null, nota: borradorGeneral });
        if (!ok) throw new Error('');
      }
      const res = await fetchWithCsrf(`/api/ai/probar/sesiones/${id}/mejorar`, { method: 'POST' });
      const json = (await res.json().catch(() => null)) as { propuestas?: Propuestas; error?: string } | null;
      if (!res.ok || !json?.propuestas) throw new Error(json?.error ?? '');
      setSesion((prev) => (prev ? { ...prev, propuestas: json.propuestas ?? null } : prev));
      if (!json.propuestas.reglas.length && !json.propuestas.plataforma.length) {
        toast.success(t('assistant.pruebasSinCambios'));
      }
      onCambio();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setProponiendo(false);
    }
  }

  async function borrar() {
    if (!confirm(t('assistant.pruebasBorrarConfirm'))) return;
    setBorrando(true);
    const res = await fetchWithCsrf(`/api/ai/probar/sesiones/${id}`, { method: 'DELETE' }).catch(() => null);
    setBorrando(false);
    if (res?.ok) onBorrada();
    else toast.error(t('assistant.probarFallo'));
  }

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
  const hayFeedback = (sesion.feedback ?? []).length > 0 || Boolean(borradorGeneral?.trim());

  /** Marcar la prueba guardada: cada respuesta y la prueba entera. */
  async function marcar(item: number | null, marca: MarcaDeFeedback): Promise<boolean> {
    if (!sesion) return false;
    const at = new Date().toISOString();
    const resto = (sesion.feedback ?? []).filter((f) => f.item !== item);
    const feedback = marca.voto || marca.nota.trim() ? [...resto, { item, voto: marca.voto, nota: marca.nota.trim(), at }] : resto;
    setSesion({ ...sesion, feedback });
    const res = await fetchWithCsrf(`/api/ai/probar/sesiones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('assistant.probarFallo'));
      return false;
    }
    onCambio();
    return true;
  }
  const nombreDe = (agenteId: string | null) =>
    agenteId ? (agentes.find((a) => a.id === agenteId)?.name ?? '—') : t('assistant.pruebasTodosLosAsistentes');

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
            {sesion.detalle?.producto ? ` · ${sesion.detalle.producto}` : ''}
            {sesion.origen === 'link' ? ` · ${t('assistant.pruebasPorLink')}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => void borrar()} disabled={borrando} aria-label={t('assistant.pruebasBorrar')}>
          {borrando ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start">
        <div className="space-y-2">
          <ComentarioGeneral
            valor={borradorGeneral ?? general}
            onCambio={setBorradorGeneral}
            onGuardar={() => {
              if (borradorGeneral !== null && borradorGeneral.trim() !== general.trim()) {
                void marcar(null, { voto: null, nota: borradorGeneral });
              }
            }}
          />
          <MarcoDeTelefono
            titulo={nombreComercio || t('templates.yourBusiness')}
            alto="h-[60dvh] min-h-[360px] sm:h-[min(560px,64vh)]"
          >
            {sesion.items.map((it, i) => (
              <Linea
                key={i}
                it={it}
                feedback={porItem.get(i) ?? null}
                onFeedback={(m) => void marcar(i, m)}
              />
            ))}
          </MarcoDeTelefono>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-foreground text-sm font-medium">{t('assistant.pruebasMejoras')}</p>
            <Button size="sm" onClick={() => void proponer()} disabled={proponiendo || !hayFeedback}>
              {proponiendo ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {sesion.propuestas ? t('assistant.pruebasProponerOtraVez') : t('assistant.pruebasProponer')}
            </Button>
          </div>
          {!hayFeedback ? <p className="text-muted-foreground text-xs">{t('assistant.pruebasSinFeedback')}</p> : null}
          {sesion.propuestas?.reglas.map((r, i) => (
            <TarjetaDeRegla
              key={`${i}-${sesion.propuestas?.generadas_at ?? ''}`}
              urlAplicar={`/api/ai/probar/sesiones/${id}/aplicar`}
              indice={i}
              regla={r}
              agente={r.accion === 'crear' ? nombreDe(r.agente_id) : null}
              onAplicada={(p) => setSesion((prev) => (prev ? { ...prev, propuestas: p } : prev))}
            />
          ))}
          {sesion.propuestas?.plataforma.map((p, i) => (
            <div key={i} className="border-border space-y-1.5 rounded-xl border p-3">
              <Badge variant="secondary">{t('assistant.pruebasParaPlataforma')}</Badge>
              <p className="text-foreground text-sm">{p.problema}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Lo que opina quien revisa sobre la prueba entera: tono, largo, datos, pasos. */
function ComentarioGeneral({
  valor,
  onCambio,
  onGuardar,
}: {
  valor: string;
  onCambio: (nota: string) => void;
  onGuardar: () => void;
}) {
  const t = useT();
  return (
    <Textarea
      value={valor}
      rows={2}
      maxLength={1000}
      onChange={(e) => onCambio(e.target.value)}
      onBlur={onGuardar}
      placeholder={t('assistant.pruebasComentarioPlaceholder')}
      className="min-h-0 bg-[#fff5c4]/60 text-sm"
    />
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
