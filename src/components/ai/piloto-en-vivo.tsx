'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Play, Rocket, X } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CANALES_DE_PRUEBA } from '@/components/ai/chat-de-prueba';
import type { Piloto } from '@/lib/piloto';
import { cn } from '@/lib/utils';

/**
 * El piloto en vivo (`lib/piloto`): todo lo armado funcionando de verdad, con
 * techo. Se configura y se inicia acá; al llegar al límite la IA queda en pausa
 * hasta pasar a producción.
 */

interface EstadoDeLaCuenta {
  motor_encendido: boolean;
  ia_habilitada: boolean;
  ia_motivo: string | null;
  asistentes: Array<{ nombre: string; activo: boolean }>;
  automatizaciones_activas: number;
  canales: string[];
}

const CANALES_DEL_PILOTO: Array<{ id: string; label: string }> = [
  ...CANALES_DE_PRUEBA.map((c) => ({ id: c.id as string, label: c.label })),
  { id: 'tiktok_comment', label: 'TikTok' },
];

export function PilotoEnVivo() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [piloto, setPiloto] = useState<Piloto | null>(null);
  const [estado, setEstado] = useState<EstadoDeLaCuenta | null>(null);
  const [cargado, setCargado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [canales, setCanales] = useState<string[]>([]);
  const [mensajes, setMensajes] = useState('');
  const [comentarios, setComentarios] = useState('');
  const [automatizaciones, setAutomatizaciones] = useState('');
  const [numeros, setNumeros] = useState('');
  // Confirmación en la página: el confirm() nativo no aparece en todos los navegadores.
  const [confirmar, setConfirmar] = useState<'iniciar' | 'produccion' | null>(null);

  const aplicar = (p: Piloto | null) => {
    setPiloto(p);
    setCanales(p?.canales ?? []);
    setMensajes(p?.limite_mensajes == null ? '' : String(p.limite_mensajes));
    setComentarios(p?.limite_comentarios == null ? '' : String(p.limite_comentarios));
    setAutomatizaciones(p?.limite_automatizaciones == null ? '' : String(p.limite_automatizaciones));
    setNumeros((p?.solo_numeros ?? []).join('\n'));
  };

  const cargar = useCallback(async () => {
    const res = await fetch('/api/ai/piloto', { cache: 'no-store' }).catch(() => null);
    const json = res?.ok ? ((await res.json()) as { piloto: Piloto | null; estado: EstadoDeLaCuenta }) : null;
    // Un piloto terminado es historia: se muestra lo que dio, y se arma uno nuevo.
    aplicar(json?.piloto && json.piloto.estado !== 'terminado' ? json.piloto : null);
    if (json?.piloto?.estado === 'terminado') setPiloto(json.piloto);
    setEstado(json?.estado ?? null);
    setCargado(true);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const configuracion = () =>
    JSON.stringify({
      canales,
      limite_mensajes: mensajes,
      limite_comentarios: comentarios,
      limite_automatizaciones: automatizaciones,
      solo_numeros: numeros,
    });

  async function guardar() {
    setGuardando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/piloto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: configuracion(),
      });
      const json = (await res.json().catch(() => null)) as { piloto?: Piloto; error?: string } | null;
      if (!res.ok || !json?.piloto) throw new Error(json?.error ?? '');
      aplicar(json.piloto);
      toast.success(t('assistant.pilotoGuardado'));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setGuardando(false);
    }
  }

  /** Un solo paso para arrancar: guarda lo que está en pantalla y lo inicia. */
  async function guardarEIniciar() {
    setConfirmar(null);
    setGuardando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/piloto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: configuracion(),
      });
      if (!res.ok) throw new Error('');
      await accion('iniciar');
    } catch {
      toast.error(t('assistant.probarFallo'));
      setGuardando(false);
    }
  }

  async function accion(a: 'iniciar' | 'produccion' | 'descartar') {
    setConfirmar(null);
    setGuardando(true);
    try {
      const res = await fetchWithCsrf('/api/ai/piloto', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: a }),
      });
      if (!res.ok) throw new Error('');
      await cargar();
    } catch {
      toast.error(t('assistant.probarFallo'));
    } finally {
      setGuardando(false);
    }
  }

  if (!cargado) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  const vivo = piloto && (piloto.estado === 'activo' || piloto.estado === 'agotado');
  const faltan = estado
    ? [
        !estado.motor_encendido ? t('assistant.pilotoMotorApagado') : null,
        !estado.ia_habilitada ? t('assistant.pilotoIaPausada') : null,
        !estado.asistentes.some((a) => a.activo) ? t('assistant.pilotoSinAsistentes') : null,
        estado.automatizaciones_activas === 0 ? t('assistant.pilotoSinAutomatizaciones') : null,
      ].filter((x): x is string => Boolean(x))
    : [];
  const editable = !piloto || piloto.estado === 'borrador' || piloto.estado === 'terminado';

  return (
    <div className="space-y-5">
      <Dialog open={confirmar !== null} onOpenChange={(v) => (!v ? setConfirmar(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmar === 'produccion' ? t('assistant.pilotoProduccion') : t('assistant.pilotoIniciar')}</DialogTitle>
            <DialogDescription>
              {confirmar === 'produccion' ? t('assistant.pilotoProduccionConfirm') : t('assistant.pilotoIniciarConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmar(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void (confirmar === 'produccion' ? accion('produccion') : guardarEIniciar())}>
              {confirmar === 'produccion' ? t('assistant.pilotoProduccion') : t('assistant.pilotoIniciar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Un borrador es el formulario de abajo: la tarjeta es para ver cómo va. */}
      {piloto && piloto.estado !== 'borrador' ? (
        <div
          className={cn(
            'space-y-3 rounded-xl border p-4',
            piloto.estado === 'agotado' ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Rocket className="text-muted-foreground size-4" />
              <span className="text-foreground text-sm font-medium">{t('assistant.pilotoTitulo')}</span>
              <Badge variant={piloto.estado === 'activo' ? 'default' : 'outline'}>
                {t(`assistant.pilotoEstado_${piloto.estado}`)}
              </Badge>
            </div>
            {piloto.iniciado_at ? (
              <span className="text-muted-foreground text-xs">
                {t('assistant.pilotoDesde', {
                  fecha: format.dateTime(piloto.iniciado_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                })}
              </span>
            ) : null}
          </div>
          {piloto.estado === 'agotado' ? <p className="text-sm">{t('assistant.pilotoAgotado')}</p> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Uso etiqueta={t('assistant.pilotoMensajes')} usados={piloto.usados_mensajes} limite={piloto.limite_mensajes} />
            <Uso etiqueta={t('assistant.pilotoComentarios')} usados={piloto.usados_comentarios} limite={piloto.limite_comentarios} />
            <Uso
              etiqueta={t('assistant.pilotoAutomatizaciones')}
              usados={piloto.usados_automatizaciones}
              limite={piloto.limite_automatizaciones}
            />
          </div>
          {vivo ? (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setConfirmar('produccion')} disabled={guardando}>
                <Check className="size-3.5" />
                {t('assistant.pilotoProduccion')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Sólo lo que falta para que el piloto conteste: lo que ya está bien no se lista. */}
      {faltan.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          {faltan.map((f) => (
            <li key={f} className="flex items-center gap-2 text-xs">
              <X className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              {f}
            </li>
          ))}
        </ul>
      ) : null}

      {editable || vivo ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('assistant.pilotoCanales')}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCanales([])}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  canales.length === 0 ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {t('assistant.pilotoTodos')}
              </button>
              {CANALES_DEL_PILOTO.map((c) => {
                const marcado = canales.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCanales((prev) => (marcado ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      marcado ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {c.label.startsWith('assistant.') ? t(c.label) : c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Limite etiqueta={t('assistant.pilotoMensajes')} valor={mensajes} onCambio={setMensajes} />
            <Limite etiqueta={t('assistant.pilotoComentarios')} valor={comentarios} onCambio={setComentarios} />
            <Limite etiqueta={t('assistant.pilotoAutomatizaciones')} valor={automatizaciones} onCambio={setAutomatizaciones} />
          </div>
          <p className="text-muted-foreground -mt-2 text-[11px]">{t('assistant.pilotoLimitesHint')}</p>
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('assistant.pilotoNumeros')}</p>
            <Textarea
              value={numeros}
              rows={3}
              onChange={(e) => setNumeros(e.target.value)}
              placeholder={t('assistant.pilotoNumerosPlaceholder')}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {piloto?.estado === 'borrador' ? (
              <Button type="button" variant="ghost" onClick={() => void accion('descartar')} disabled={guardando}>
                <X className="size-4" />
                {t('assistant.pilotoDescartar')}
              </Button>
            ) : null}
            <Button type="submit" variant="outline" disabled={guardando}>
              {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
              {vivo ? t('assistant.pilotoGuardarCambios') : t('assistant.pilotoGuardar')}
            </Button>
            {!vivo ? (
              <Button type="button" disabled={guardando} onClick={() => setConfirmar('iniciar')}>
                <Play className="size-4" />
                {t('assistant.pilotoIniciar')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Uso({ etiqueta, usados, limite }: { etiqueta: string; usados: number; limite: number | null }) {
  const t = useT();
  const pct = limite ? Math.min(100, Math.round((usados / Math.max(limite, 1)) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{etiqueta}</span>
        <span className="text-foreground tabular-nums">
          {usados} / {limite === null ? t('assistant.pilotoSinTope') : limite}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full" style={{ width: `${limite === null ? 0 : pct}%` }} />
      </div>
    </div>
  );
}

function Limite({ etiqueta, valor, onCambio }: { etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  const t = useT();
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground block text-[11px] font-medium tracking-wide uppercase">{etiqueta}</span>
      <Input
        value={valor}
        inputMode="numeric"
        onChange={(e) => onCambio(e.target.value.replace(/\D/g, ''))}
        placeholder={t('assistant.pilotoSinTope')}
        className="text-base sm:text-sm"
      />
    </label>
  );
}
