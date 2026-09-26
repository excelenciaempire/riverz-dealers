"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Send, Sparkles, X } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import {
  Linea,
  MarcoDeTelefono,
  etiquetaDeCanal,
  etiquetaDeEscenario,
  type ItemChat,
  type MarcaDeFeedback,
} from "@/components/ai/chat-de-prueba";
import { TarjetaDeRegla } from "@/components/ai/pruebas-guardadas";
import type { FeedbackGuardado, Propuestas } from "@/lib/ai/sesiones-de-prueba";
import { cn } from "@/lib/utils";
import { useAdminData, useTabParam, PageHeader, Loading, LoadError, Tabs, StatusPill, Muted } from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * Pruebas y feedback, por comercio. El comercio comenta y envía; acá el equipo
 * propone las mejoras, las aplica y aprueba los cambios de plantilla.
 */

interface Comercio {
  id: string;
  nombre: string;
  pruebas: number;
  feedbackPruebas: number;
  feedbackReal: number;
  plataforma: number;
}

interface Prueba {
  id: string;
  origen: "panel" | "link";
  escenario: string | null;
  canal: string | null;
  items: ItemChat[];
  feedback: FeedbackGuardado[];
  propuestas: Propuestas | null;
  enviada_at: string | null;
  created_at: string;
}

interface FeedbackReal {
  id: string;
  canal: string | null;
  voto: "bien" | "mal" | null;
  nota: string;
  captura: ItemChat[];
  created_at: string;
}

interface Lote {
  id: string;
  propuestas: Propuestas | null;
  created_at: string;
}

interface Cambio {
  id: string;
  plantilla_nombre: string;
  antes: string;
  despues: string;
  estado: "pendiente" | "aprobado" | "descartado" | "fallido";
  nueva_plantilla: string | null;
  motivo: string | null;
  created_at: string;
}

interface PedidoPlataforma {
  id: string;
  origen: "prueba" | "bandeja";
  problema: string;
  prompt: string;
  estado: "pendiente" | "en_curso" | "resuelta" | "descartada";
  created_at: string;
}

interface Datos {
  comercio: string | null;
  pruebas: Prueba[];
  feedback: FeedbackReal[];
  plataforma: PedidoPlataforma[];
  cambios: Cambio[];
  lotes: Lote[];
  agentes: Array<{ id: string; name: string }>;
}

type Pestana = "pruebas" | "reales" | "plantillas" | "plataforma";
const PESTANAS: readonly Pestana[] = ["pruebas", "reales", "plantillas", "plataforma"];

export default function AdminMejorasPage() {
  const t = useT();
  const [elegido, setElegido] = useState<string | null>(null);
  const [pestana, setPestana] = useTabParam<Pestana>("tab", PESTANAS, "pruebas");
  const lista = useAdminData<{ comercios: Comercio[] }>("/api/admin/mejoras");
  const comercios = lista.data?.comercios ?? [];
  const actual = elegido ?? comercios[0]?.id ?? null;

  if (lista.loading && !lista.data) return <Loading forma="table" />;
  if (lista.error || !lista.data) return <LoadError onRetry={lista.reload} />;

  return (
    <div className="space-y-4">
      <PageHeader title={t("admin.sectionMejoras")} live={lista.live} actions={<RefreshButton onClick={lista.reload} />} />
      {comercios.length === 0 ? (
        <Muted>{t("admin.mejorasVacio")}</Muted>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <ul className="border-border divide-border h-fit divide-y overflow-hidden rounded-xl border">
            {comercios.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setElegido(c.id)}
                  className={cn(
                    "hover:bg-muted/50 w-full px-4 py-2.5 text-left text-sm transition-colors",
                    actual === c.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {c.nombre}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 space-y-4">
            <Tabs
              value={pestana}
              onChange={setPestana}
              options={[
                { value: "pruebas", label: t("admin.mejorasPruebas") },
                { value: "reales", label: t("admin.mejorasTabReales") },
                { value: "plantillas", label: t("admin.mejorasTabPlantillas") },
                { value: "plataforma", label: t("admin.mejorasTabPlataforma") },
              ]}
            />
            {actual ? <DelComercio key={actual} id={actual} pestana={pestana} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function DelComercio({ id, pestana }: { id: string; pestana: Pestana }) {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const { data, loading, error, reload } = useAdminData<Datos>(`/api/admin/mejoras?workspace=${encodeURIComponent(id)}`);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  // Lo que se va proponiendo y aplicando, sin esperar al refresco.
  const [propuestasDe, setPropuestasDe] = useState<Record<string, Propuestas>>({});


  if (loading && !data) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;
  const titulo = data.comercio ?? "—";
  const fecha = (iso: string) => format.dateTime(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const nombreDe = (agenteId: string | null) =>
    agenteId ? (data.agentes.find((a) => a.id === agenteId)?.name ?? "—") : t("assistant.pruebasTodosLosAsistentes");

  async function accion(que: string, objetivo: string): Promise<Record<string, unknown> | null> {
    setTrabajando(`${que}:${objetivo}`);
    try {
      const res = await fetchWithCsrf(`/api/admin/mejoras/accion?que=${que}&id=${encodeURIComponent(objetivo)}`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new Error(String(json?.error ?? ""));
      return json;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("admin.mejorasError"));
      return null;
    } finally {
      setTrabajando(null);
    }
  }

  const Propuestas = ({ clave, url, propuestas }: { clave: string; url: string; propuestas: Propuestas | null }) => {
    const p = propuestasDe[clave] ?? propuestas;
    if (!p || (!p.reglas.length && !p.plataforma.length)) return null;
    return (
      <div className="space-y-2">
        {p.reglas.map((r, i) => (
          <TarjetaDeRegla
            key={`${clave}-${i}-${p.generadas_at ?? ""}`}
            urlAplicar={url}
            indice={i}
            regla={r}
            agente={r.accion === "crear" ? nombreDe(r.agente_id) : null}
            onAplicada={(nuevas) => setPropuestasDe((prev) => ({ ...prev, [clave]: nuevas }))}
          />
        ))}
        {p.plataforma.map((x, i) => (
          <p key={i} className="border-border rounded-lg border px-3 py-2 text-xs">
            {x.problema}
          </p>
        ))}
      </div>
    );
  };

  if (pestana === "pruebas") {
    if (data.pruebas.length === 0) return <Muted>{t("admin.mejorasVacio")}</Muted>;
    return (
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.pruebas.map((p) => {
          const marcas = new Map<number, MarcaDeFeedback>();
          for (const f of p.feedback ?? []) if (f.item !== null) marcas.set(f.item, { voto: f.voto, nota: f.nota });
          const general = (p.feedback ?? []).find((f) => f.item === null && f.nota)?.nota;
          const conFeedback = (p.feedback ?? []).length > 0;
          const clave = `prueba:${p.id}`;
          return (
            <article key={p.id} className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground truncate font-medium">
                  {etiquetaDeEscenario(t, p.escenario)} · {etiquetaDeCanal(t, p.canal)}
                  <span className="text-muted-foreground font-normal"> · {fecha(p.created_at)}</span>
                </span>
                {p.enviada_at ? <StatusPill tone="ok" label={t("admin.mejorasEnviada")} /> : null}
              </div>
              {general ? <p className="rounded-lg bg-[#fff5c4] px-3 py-2 text-xs whitespace-pre-wrap text-[#54656f]">{general}</p> : null}
              <MarcoDeTelefono titulo={titulo} alto="h-[360px]">
                {(p.items ?? []).map((it, i) => (
                  <Linea key={i} it={it} feedback={marcas.get(i) ?? null} />
                ))}
              </MarcoDeTelefono>
              {conFeedback ? (
                <button
                  type="button"
                  disabled={trabajando !== null}
                  onClick={async () => {
                    const r = await accion("proponer-prueba", p.id);
                    if (r?.propuestas) setPropuestasDe((prev) => ({ ...prev, [clave]: r.propuestas as Propuestas }));
                  }}
                  className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                >
                  {trabajando === `proponer-prueba:${p.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {t("admin.mejorasProponer")}
                </button>
              ) : null}
              <Propuestas clave={clave} url={`/api/admin/mejoras/accion?que=aplicar-prueba&id=${p.id}`} propuestas={p.propuestas} />
            </article>
          );
        })}
      </div>
    );
  }

  if (pestana === "reales") {
    const lote = data.lotes[0] ?? null;
    return (
      <div className="space-y-4">
        {data.feedback.length > 0 ? (
          <button
            type="button"
            disabled={trabajando !== null}
            onClick={async () => {
              const r = await accion("proponer-real", id);
              if (r?.sin_feedback) toast.success(t("admin.mejorasSinFeedbackNuevo"));
              else if (r?.lote) {
                const l = r.lote as { id: string; propuestas: Propuestas };
                setPropuestasDe((prev) => ({ ...prev, "lote:ultimo": l.propuestas }));
                reload();
              }
            }}
            className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            {trabajando === `proponer-real:${id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {t("admin.mejorasProponer")}
          </button>
        ) : null}
        {lote ? <Propuestas clave="lote:ultimo" url={`/api/admin/mejoras/accion?que=aplicar-lote&id=${lote.id}`} propuestas={lote.propuestas} /> : null}
        {data.feedback.length === 0 ? (
          <Muted>{t("admin.mejorasVacio")}</Muted>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.feedback.map((f) => (
              <article key={f.id} className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  {etiquetaDeCanal(t, f.canal)} · {fecha(f.created_at)}
                </p>
                <MarcoDeTelefono titulo={titulo} alto="h-[340px]">
                  {(f.captura ?? []).map((it, i) => (
                    <Linea key={i} it={it} feedback={i === (f.captura ?? []).length - 1 ? { voto: f.voto, nota: f.nota } : null} />
                  ))}
                </MarcoDeTelefono>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (pestana === "plantillas") {
    if (data.cambios.length === 0) return <Muted>{t("admin.mejorasVacio")}</Muted>;
    return (
      <div className="space-y-4">
        {data.cambios.map((c) => (
          <article key={c.id} className="border-border space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground text-sm font-medium">
                {c.plantilla_nombre}
                <span className="text-muted-foreground font-normal"> · {fecha(c.created_at)}</span>
              </span>
              <StatusPill
                tone={c.estado === "pendiente" ? "warn" : c.estado === "aprobado" ? "ok" : c.estado === "fallido" ? "error" : "muted"}
                label={t(`admin.mejorasCambio_${c.estado}`)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Burbuja titulo={t("admin.mejorasAntes")} texto={c.antes} />
              <Burbuja titulo={t("admin.mejorasDespues")} texto={c.despues} resaltada />
            </div>
            {c.estado === "aprobado" && c.nueva_plantilla ? (
              <p className="text-muted-foreground text-xs">{t("admin.mejorasNuevaPlantilla", { nombre: c.nueva_plantilla })}</p>
            ) : null}
            {c.estado === "fallido" && c.motivo ? <p className="text-destructive text-xs">{c.motivo}</p> : null}
            {c.estado === "pendiente" ? (
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={trabajando !== null}
                  onClick={async () => {
                    if (await accion("descartar-cambio", c.id)) reload();
                  }}
                  className="text-muted-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs"
                >
                  <X className="size-3.5" />
                  {t("admin.mejorasDescartar")}
                </button>
                <button
                  type="button"
                  disabled={trabajando !== null}
                  onClick={async () => {
                    const r = await accion("aprobar-cambio", c.id);
                    if (r?.nueva) toast.success(t("admin.mejorasNuevaPlantilla", { nombre: String(r.nueva) }));
                    reload();
                  }}
                  className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-60"
                >
                  {trabajando === `aprobar-cambio:${c.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  {t("admin.mejorasAprobarCambio")}
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    );
  }

  async function cambiarPedido(pedido: PedidoPlataforma, estado: PedidoPlataforma["estado"]) {
    const res = await fetchWithCsrf("/api/admin/mejoras", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pedido.id, estado }),
    }).catch(() => null);
    if (!res?.ok) toast.error(t("admin.mejorasError"));
    reload();
  }

  if (data.plataforma.length === 0) return <Muted>{t("admin.mejorasVacio")}</Muted>;
  return (
    <div className="space-y-3">
      {data.plataforma.map((p) => (
        <article key={p.id} className="border-border space-y-2 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-foreground text-sm">{p.problema || "—"}</p>
            <StatusPill
              tone={p.estado === "pendiente" ? "warn" : p.estado === "resuelta" ? "ok" : "muted"}
              label={t(`admin.mejorasEstado_${p.estado}`)}
            />
          </div>
          <pre className="bg-muted text-foreground rounded-lg px-3 py-2 text-xs whitespace-pre-wrap">{p.prompt}</pre>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(p.prompt).catch(() => {});
                toast.success(t("admin.mejorasCopiado"));
              }}
              className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs"
            >
              <Copy className="size-3.5" />
              {t("admin.mejorasCopiar")}
            </button>
            {p.estado === "pendiente" || p.estado === "en_curso" ? (
              <>
                <button
                  type="button"
                  onClick={() => void cambiarPedido(p, "descartada")}
                  className="text-muted-foreground hover:bg-muted rounded-md px-2.5 py-1 text-xs"
                >
                  {t("admin.mejorasDescartar")}
                </button>
                <button
                  type="button"
                  onClick={() => void cambiarPedido(p, "resuelta")}
                  className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs"
                >
                  <Check className="size-3.5" />
                  {t("admin.mejorasResuelta")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void cambiarPedido(p, "pendiente")}
                className="text-muted-foreground hover:bg-muted rounded-md px-2.5 py-1 text-xs"
              >
                {t("admin.mejorasReabrir")}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function Burbuja({ titulo, texto, resaltada }: { titulo: string; texto: string; resaltada?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{titulo}</p>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap text-[#111b21]",
          resaltada ? "bg-[#dcf8c6]" : "bg-white",
        )}
      >
        {texto}
      </div>
    </div>
  );
}
