'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { MAX_TEXTO_REGLA } from '@/lib/ai/guidance';
import { RuleVersions } from './rule-versions';

/**
 * Las reglas del comercio.
 *
 * Antes de esto, decirle al agente "nunca prometas una fecha de entrega" tenía
 * tres lugares y ninguno servía: la persona —un párrafo donde todo compite con
 * todo—, las reglas por producto —que sólo valen si el tema ES un producto— y
 * el pliego, que preguntaba y guardaba la respuesta sin que la leyera nadie.
 *
 * Una regla tiene nombre, cuándo aplica y qué hacer. Y un interruptor, que es
 * lo que convierte afinar un agente en algo que se puede probar: apagar una
 * regla y ver si mejora, en vez de borrar texto de un párrafo y confiar en
 * acordarse de lo que decía.
 */

interface Regla {
  id: string;
  titulo: string;
  cuando: string | null;
  hacer: string;
  activa: boolean;
  origen: 'comercio' | 'pliego' | 'base' | 'hueco';
  live_revision: number;
}

export function ReglasPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [cuando, setCuando] = useState('');
  const [hacer, setHacer] = useState('');
  const [isAdmin,setIsAdmin]=useState(false);
  const [loadError,setLoadError]=useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/reglas', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(String(res.status));
      setReglas(json.reglas ?? []);setIsAdmin(json.is_admin===true);setLoadError(false);
    } catch {
      setReglas(previous => previous ?? []);setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const crear = async () => {
    if (!titulo.trim() || !hacer.trim()) return;
    setGuardando(true);
    try {
      const res = await fetchWithCsrf('/api/reglas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, cuando, hacer, draft:true }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setTitulo('');
      setCuando('');
      setHacer('');
      setCreando(false);
      await cargar();
    } catch {
      toast.error(t('reglas.saveFailed'));
    } finally {
      setGuardando(false);
    }
  };

  const alternar = async (r: Regla) => {
    // Se pinta antes de que conteste el servidor: es un interruptor, y esperar
    // el ida y vuelta lo hace sentir roto.
    setReglas((prev) =>
      (prev ?? []).map((x) => (x.id === r.id ? { ...x, activa: !x.activa } : x)),
    );
    const res = await fetchWithCsrf(`/api/reglas?id=${encodeURIComponent(r.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activa: !r.activa,live_revision:r.live_revision }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('reglas.saveFailed'));
      await cargar();
    } else {
      const data=await res.json();setReglas(previous => (previous ?? []).map(x => x.id===r.id ? data.regla : x));
    }
  };

  const borrar = async (r: Regla) => {
    const res = await fetchWithCsrf(`/api/reglas?id=${encodeURIComponent(r.id)}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('reglas.saveFailed'));
      return;
    }
    await cargar();
  };

  if (reglas === null) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div>
      {reglas.length === 0 && !creando ? (
        <p className="text-xs text-muted-foreground">{t('reglas.empty')}</p>
      ) : null}

      {reglas.length > 0 ? (
        <ul className="divide-y divide-border">
          {reglas.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-2.5">
              <Switch checked={r.activa} disabled={!isAdmin} onCheckedChange={() => void alternar(r)} />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    r.activa
                      ? 'text-sm font-medium text-foreground'
                      : 'text-sm font-medium text-muted-foreground'
                  }
                >
                  {r.titulo}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.cuando ? `${r.cuando}: ` : ''}
                  {r.hacer}
                </p>
                <RuleVersions ruleId={r.id} onChanged={cargar} />
              </div>
              <button
                type="button"
                aria-label={r.titulo}
                onClick={() => void borrar(r)}
                disabled={!isAdmin}
                className="mt-0.5 text-muted-foreground transition hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {creando ? (
        <form
          className="mt-3 space-y-2 rounded-xl border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void crear();
          }}
        >
          <Input
            value={titulo}
            maxLength={80}
            placeholder={t('reglas.titlePlaceholder')}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <Input
            value={cuando}
            maxLength={200}
            placeholder={t('reglas.whenPlaceholder')}
            onChange={(e) => setCuando(e.target.value)}
          />
          <textarea
            value={hacer}
            maxLength={MAX_TEXTO_REGLA}
            rows={2}
            placeholder={t('reglas.doPlaceholder')}
            onChange={(e) => setHacer(e.target.value)}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={guardando || !titulo.trim() || !hacer.trim()}>
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('reglas.saveDraft')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreando(false)}>
              {t('reglas.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => setCreando(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-1.5">{t('reglas.add')}</span>
        </Button>
      )}
      {loadError && <p role="alert" className="mt-2 text-xs">{t('reglas.saveFailed')}</p>}
    </div>
  );
}
