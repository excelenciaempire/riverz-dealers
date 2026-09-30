'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { useFormat } from '@/hooks/use-format';
import Link from '@/components/i18n/locale-link';
import { GapKnowledgeConflicts } from './gap-knowledge-conflicts';

/**
 * Lo que el agente no supo contestar.
 *
 * Es la mitad del valor de tener un agente y hasta acá se perdía: la
 * conversación quedaba marcada para una persona, el caso se resolvía a mano, y
 * la PREGUNTA no quedaba en ningún lado. Así se arregla el caso y nunca el
 * agujero, y la misma pregunta vuelve la semana que viene.
 *
 * Va agrupado y ordenado por cuánta gente preguntó, porque esa lista es
 * accionable y la lista en bruto no: doce personas preguntando lo mismo son UN
 * párrafo que falta escribir, no doce tareas.
 */

interface Hueco {
  key: string;
  question: string;
  veces: number;
  ultima: string;
  missing: string | null;
  conversation_id?: string | null;
}
type Review={ id:string;question:string;answer:string;target_title:string;destination:string;previous_answers:Array<{q:string;a:string}>;source_count:number;expires_at:string };
type History={ id:string;question:string;answer:string;target_id:string;target_title:string;destination:string;published_at:string;actor_id:string|null;source_ids:string[] };
function GapKnowledgeHistory({ rows }: { rows:History[] }) {
 const t=useT(),fmt=useFormat();
 return <details className="mt-3 text-xs"><summary className="cursor-pointer">{t("gaps.history")}</summary><div className="mt-2 space-y-2">{rows.length===0 ? <p>{t("gaps.noHistory")}</p> : rows.map(r => <article key={r.id} className="rounded border p-2"><p className="font-medium">{r.question}</p><p className="whitespace-pre-wrap">{r.answer}</p><p className="mt-1 text-muted-foreground">{r.target_title} · {fmt.dateTime(r.published_at)} · {t("gaps.historyOrigin",{n:fmt.number(r.source_ids.length)})}</p>{r.destination==="producto" && <Link className="underline" href={`/productos/${r.target_id}`}>{t("gaps.openTarget")}</Link>}{r.destination==="regla" && <Link className="underline" href="/asistente">{t("gaps.openTarget")}</Link>}</article>)}</div></details>;
}

export function AnswerGapsPanel() {
  const t = useT();
  const fmt=useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [gaps, setGaps] = useState<Hueco[] | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  // Cuál se está respondiendo. Uno por vez: contestar bien una pregunta es
  // trabajo de leer y escribir, y abrir cinco formularios a la vez no ayuda.
  const [abierto, setAbierto] = useState<string | null>(null);
  const [productos, setProductos] = useState<Array<{ id: string; title: string }>>([]);
  const [productoId, setProductoId] = useState('');
  // Dónde va la respuesta. No todo es del producto: "¿puedo retirar en
  // sucursal?", "¿hacen factura A?", "¿cuánto tarda el envío?" son políticas
  // del negocio, y meterlas en la ficha de UN producto las hace desaparecer
  // cuando el cliente pregunta por otro.
  const [destino, setDestino] = useState<'producto' | 'regla'>('producto');
  const [respuesta, setRespuesta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [review,setReview]=useState<Review|null>(null),[history,setHistory]=useState<History[]>([]),[loadError,setLoadError]=useState(false),[truncated,setTruncated]=useState(false),[isAdmin,setIsAdmin]=useState(false);
  const loading=useRef<AbortController|null>(null),operation=useRef<AbortController|null>(null);
  useEffect(() => () => { loading.current?.abort();operation.current?.abort() },[]);

  const cargar = useCallback(async () => {
    loading.current?.abort();const c=new AbortController();loading.current=c;
    try {
      const res = await fetch('/api/huecos',{ signal:c.signal,cache:'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error();
      if (!c.signal.aborted) { setGaps(json.gaps ?? []);setHistory(json.history ?? []);setTruncated(json.truncated===true);setIsAdmin(json.is_admin===true);setLoadError(false) }
    } catch {
      if (!c.signal.aborted) setLoadError(true);
    } finally { if (loading.current===c) loading.current=null }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El catálogo se pide una sola vez y sólo cuando hace falta elegir: la
  // pantalla se abre para MIRAR la lista, y traer el catálogo entero para eso
  // sería un viaje que casi siempre se tira.
  useEffect(() => {
    if (!abierto || productos.length > 0) return;
    fetch('/api/shopify/products')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const lista = (j?.products ?? []) as Array<{ id: string; title: string }>;
        setProductos(lista);
        if (lista.length === 1) setProductoId(lista[0].id);
      })
      .catch(() => {});
  }, [abierto, productos.length]);

  const resolver = async (key: string) => {
    if (operation.current) return;
    const c=new AbortController();operation.current=c;setMarcando(key);
    try {
      const res=await fetchWithCsrf('/api/huecos',{ method:'PATCH',headers:{ 'Content-Type':'application/json' },signal:c.signal,body:JSON.stringify({ key }) });
      const json=await res.json();if (!res.ok || !json.ok) throw new Error(json.error || t('gaps.saveFailed'));
      if (!c.signal.aborted) { setReview(null);await cargar() }
    } catch(e) { if (!c.signal.aborted) toast.error(e instanceof Error && e.message!=='Failed to fetch' ? e.message : t('gaps.confirmationFailed')) }
    finally { if (!c.signal.aborted) setMarcando(null);if (operation.current===c) operation.current=null }
  };

  const responder = async (g: Hueco) => {
    if (operation.current || respuesta.trim().length < 2 || destino==='producto' && !productoId) return;
    const c=new AbortController();operation.current=c;setEnviando(true);
    try {
      let current=review;
      if (!current) {
        const res=await fetchWithCsrf('/api/huecos/responder',{ method:'POST',headers:{ 'Content-Type':'application/json' },signal:c.signal,body:JSON.stringify({ action:'preview',key:g.key,destino,product_id:productoId,question:g.question,answer:respuesta.trim() }) });
        const json=await res.json();if (!res.ok) throw new Error(json.error || t('gaps.saveFailed'));
        current=json.review as Review;if (!current?.id) throw new Error(t('gaps.saveFailed'));
        if (c.signal.aborted) return;
        if (SHOW_RIVERZ_IMPROVEMENTS) { setReview(current);return }
      }
      const res=await fetchWithCsrf('/api/huecos/responder',{ method:'POST',headers:{ 'Content-Type':'application/json' },signal:c.signal,body:JSON.stringify({ action:'confirm',review_id:current.id }) });
      const json=await res.json();if (!res.ok) throw new Error(json.error || t('gaps.saveFailed'));
      if (!json.ok) throw new Error(t('gaps.confirmationFailed'));
      if (c.signal.aborted) return;
      setAbierto(null);setRespuesta('');setReview(null);toast.success(t('gaps.answered'));await cargar();
    } catch(e) {
      if (!c.signal.aborted) { setReview(null);toast.error(e instanceof Error && e.message!=='Failed to fetch' ? e.message : t('gaps.confirmationFailed')) }
    } finally { if (!c.signal.aborted) setEnviando(false);if (operation.current===c) operation.current=null }
  };

  if (loadError) return <div role="alert" className="space-y-2 py-3 text-sm"><p>{t('gaps.loadFailed')}</p><Button variant="outline" size="sm" onClick={() => void cargar()}>{t('common.retry')}</Button></div>;

  if (gaps === null) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <> <div className="flex flex-col items-center gap-1.5 py-8 text-center">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm text-muted-foreground">{t('gaps.empty')}</p>
      </div>{SHOW_RIVERZ_IMPROVEMENTS && <GapKnowledgeHistory rows={history} />}</>
    );
  }

  return (
    <div className="space-y-2">
      {SHOW_RIVERZ_IMPROVEMENTS && truncated && <p role="status" className="text-xs">{t("gaps.partial")}</p>}
      {gaps.map((g) => (
        <div key={g.key} className="rounded-lg border border-border px-3 py-2.5">
          <div className="flex items-start gap-3">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{g.question}</p>
              {g.missing ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{g.missing}</p>
              ) : null}
              {SHOW_RIVERZ_IMPROVEMENTS && g.conversation_id && <Link className="mt-1 block text-xs underline" href={`/bandeja?c=${g.conversation_id}`}>{t("gaps.openSource")}</Link>}
              {/* Cuánta gente preguntó lo mismo. Es lo que decide por dónde
                  empezar: una pregunta repetida doce veces vale doce veces más
                  que una suelta. */}
              {g.veces > 1 ? (
                <p className="mt-0.5 text-[11px] font-medium text-foreground">
                  {t('gaps.times', { n: fmt.number(g.veces) })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={enviando || marcando!==null}
                onClick={() => {
                  setAbierto(abierto === g.key ? null : g.key);
                  setRespuesta('');setReview(null);
                }}
              >
                {t('gaps.answer')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={enviando || marcando!==null}
                onClick={() => resolver(g.key)}
              >
                {t('gaps.markDone')}
              </Button>
            </div>
          </div>

          {/* Cargar la respuesta acá mismo. Sin esto la lista era un reproche:
              el comercio leía qué no supo el agente y tenía que ir a buscar el
              producto, abrirlo y pegar el texto a mano. La mitad no lo hacía y
              la misma pregunta volvía a la semana. */}
          {abierto === g.key ? (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              <select
                disabled={enviando}
                value={destino}
                onChange={(e) =>
                  { setDestino(e.target.value === 'regla' ? 'regla' : 'producto');setReview(null) }
                }
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              >
                <option value="producto">{t('gaps.destProduct')}</option>
                <option value="regla" disabled={!isAdmin}>{t('gaps.destRule')}</option>
              </select>
              {destino === 'producto' ? (
                <select
                  value={productoId}
                  disabled={enviando}
                  onChange={(e) => { setProductoId(e.target.value);setReview(null) }}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="">{t('gaps.pickProduct')}</option>
                  {productos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {t('gaps.destRuleHint')}
                </p>
              )}
              <textarea
                value={respuesta}
                disabled={enviando}
                maxLength={2000}
                onChange={(e) => { setRespuesta(e.target.value);setReview(null) }}
                rows={3}
                placeholder={t('gaps.answerPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
              />
              {SHOW_RIVERZ_IMPROVEMENTS && <p className="text-xs text-muted-foreground">{t('gaps.permanent')}</p>}
              {SHOW_RIVERZ_IMPROVEMENTS && review && <div className="space-y-2 rounded border p-2 text-xs"><p className="font-medium">{t('gaps.reviewTitle',{target:review.target_title})}</p><p className="whitespace-pre-wrap">{review.answer}</p>{review.previous_answers.length>0 && <div><p className="font-medium">{t('gaps.replaces')}</p>{review.previous_answers.map((a,i) => <p key={i} className="whitespace-pre-wrap">{a.a}</p>)}</div>}<p>{t('gaps.reviewSources',{n:fmt.number(review.source_count)})}</p><p>{t('gaps.reviewExpires',{date:fmt.dateTime(review.expires_at)})}</p><p>{t('gaps.notSent')}</p><GapKnowledgeConflicts key={review.id} reviewId={review.id} /></div>}
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    enviando ||
                    respuesta.trim().length < 2 ||
                    (destino === 'producto' && !productoId)
                  }
                  onClick={() => responder(g)}
                >
                  {t(SHOW_RIVERZ_IMPROVEMENTS ? review ? 'gaps.confirmReview' : 'gaps.reviewAnswer' : 'gaps.saveAnswer')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {SHOW_RIVERZ_IMPROVEMENTS && <GapKnowledgeHistory rows={history} />}
    </div>
  );
}
