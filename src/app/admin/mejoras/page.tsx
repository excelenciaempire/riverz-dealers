"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
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
import type { FeedbackGuardado, Propuestas } from "@/lib/ai/sesiones-de-prueba";
import { cn } from "@/lib/utils";
import {
  useAdminData,
  useTabParam,
  PageHeader,
  Loading,
  LoadError,
  Panel,
  Tabs,
  StatusPill,
  Muted,
} from "../_components/admin-ui";
import { RefreshButton } from "../_components/filters";

/**
 * Pruebas y feedback, por comercio.
 *
 * Tres cosas para entender cómo le va al asistente de un comercio y qué hay
 * que tocar: las pruebas de "Probar como cliente" (también las del dueño por
 * el link), el feedback —de pruebas y de conversaciones reales— con la
 * conversación tal cual se vio, y la cola de lo que no se arregla con una regla
 * del comercio: eso es trabajo de la plataforma.
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
  detalle: { producto?: string | null } | null;
  items: ItemChat[];
  feedback: FeedbackGuardado[];
  propuestas: Propuestas | null;
  mensajes: number;
  created_at: string;
}

interface FeedbackReal {
  id: string;
  canal: string | null;
  voto: "bien" | "mal" | null;
  nota: string;
  captura: ItemChat[];
  estado: string;
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

type Pestana = "pruebas" | "feedback-pruebas" | "feedback-real" | "plataforma";
const PESTANAS: readonly Pestana[] = ["pruebas", "feedback-pruebas", "feedback-real", "plataforma"];

export default function AdminMejorasPage() {
  const t = useT();
  const [elegido, setElegido] = useState<string | null>(null);
  const [pestana, setPestana] = useTabParam<Pestana>("tab", PESTANAS, "pruebas");
  const lista = useAdminData<{ comercios: Comercio[] }>("/api/admin/mejoras");

  if (lista.loading && !lista.data) return <Loading forma="table" />;
  if (lista.error || !lista.data) return <LoadError onRetry={lista.reload} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("admin.sectionMejoras")}
        description={t("admin.sectionMejorasDesc")}
        live={lista.live}
        actions={<RefreshButton onClick={lista.reload} />}
      />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel title={t("admin.mejorasComercio")}>
          <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
            {lista.data.comercios.length === 0 ? (
              <li className="px-4 py-3">
                <Muted>{t("admin.mejorasVacio")}</Muted>
              </li>
            ) : (
              lista.data.comercios.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(c.id)}
                    className={cn(
                      "w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                      elegido === c.id && "bg-muted",
                    )}
                  >
                    <p className="truncate text-sm font-medium text-foreground">{c.nombre}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.pruebas} {t("admin.mejorasPruebas").toLowerCase()} · {t("admin.mejorasFeedbackCuenta", { n: c.feedbackPruebas + c.feedbackReal })}
                      {c.plataforma ? ` · ${c.plataforma} ${t("admin.mejorasPlataforma").toLowerCase()}` : ""}
                    </p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Panel>
        <div className="min-w-0 space-y-4">
          <Tabs
            value={pestana}
            onChange={setPestana}
            options={[
              { value: "pruebas", label: t("admin.mejorasPruebas") },
              { value: "feedback-pruebas", label: t("admin.mejorasFeedbackPruebas") },
              { value: "feedback-real", label: t("admin.mejorasFeedbackReal") },
              { value: "plataforma", label: t("admin.mejorasPlataforma") },
            ]}
          />
          {elegido ? <DelComercio id={elegido} pestana={pestana} /> : <Muted>{t("admin.mejorasElegir")}</Muted>}
        </div>
      </div>
    </div>
  );
}

function DelComercio({ id, pestana }: { id: string; pestana: Pestana }) {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const { data, loading, error, reload } = useAdminData<{
    comercio: string | null;
    pruebas: Prueba[];
    feedback: FeedbackReal[];
    plataforma: PedidoPlataforma[];
  }>(`/api/admin/mejoras?workspace=${encodeURIComponent(id)}`);

  if (loading && !data) return <Loading />;
  if (error || !data) return <LoadError onRetry={reload} />;
  const titulo = data.comercio ?? "—";
  const fecha = (iso: string) =>
    format.dateTime(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (pestana === "pruebas" || pestana === "feedback-pruebas") {
    const pruebas =
      pestana === "pruebas" ? data.pruebas : data.pruebas.filter((p) => (p.feedback ?? []).length > 0);
    if (pruebas.length === 0) return <Muted>{t("admin.mejorasVacio")}</Muted>;
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pruebas.map((p) => {
          const marcas = new Map<number, MarcaDeFeedback>();
          for (const f of p.feedback ?? []) if (f.item !== null) marcas.set(f.item, { voto: f.voto, nota: f.nota });
          const generales = (p.feedback ?? []).filter((f) => f.item === null && f.nota);
          return (
            <article key={p.id} className="space-y-2">
              <div className="text-xs">
                <p className="truncate font-medium text-foreground">
                  {etiquetaDeEscenario(t, p.escenario)} · {etiquetaDeCanal(t, p.canal)}
                </p>
                <p className="flex items-center gap-1 text-muted-foreground">
                  {fecha(p.created_at)}
                  {p.origen === "link" ? (
                    <>
                      {" · "}
                      <Link2 className="size-3" /> {t("admin.mejorasPorLink")}
                    </>
                  ) : null}
                </p>
              </div>
              {generales.map((f, i) => (
                <p key={i} className="rounded-lg bg-[#fff5c4] px-3 py-2 text-xs whitespace-pre-wrap text-[#54656f]">
                  {f.nota}
                </p>
              ))}
              <MarcoDeTelefono titulo={titulo} alto="h-[380px]">
                {(p.items ?? []).map((it, i) => (
                  <Linea key={i} it={it} feedback={marcas.get(i) ?? null} />
                ))}
              </MarcoDeTelefono>
              {p.propuestas?.reglas.length ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("admin.mejorasReglasAplicadas", { n: p.propuestas.reglas.filter((r) => r.aplicada).length, total: p.propuestas.reglas.length })}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  if (pestana === "feedback-real") {
    if (data.feedback.length === 0) return <Muted>{t("admin.mejorasVacio")}</Muted>;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("admin.mejorasDatosTapados")}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.feedback.map((f) => (
            <article key={f.id} className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {etiquetaDeCanal(t, f.canal)} · {fecha(f.created_at)}
              </p>
              <MarcoDeTelefono titulo={titulo} alto="h-[340px]">
                {(f.captura ?? []).map((it, i) => (
                  <Linea
                    key={i}
                    it={it}
                    feedback={i === (f.captura ?? []).length - 1 ? { voto: f.voto, nota: f.nota } : null}
                  />
                ))}
              </MarcoDeTelefono>
            </article>
          ))}
        </div>
      </div>
    );
  }

  async function cambiar(pedido: PedidoPlataforma, estado: PedidoPlataforma["estado"]) {
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
        <Panel
          key={p.id}
          title={p.problema || "—"}
          actions={
            <StatusPill
              tone={p.estado === "pendiente" ? "warn" : p.estado === "resuelta" ? "ok" : "muted"}
              label={t(`admin.mejorasEstado_${p.estado}`)}
            />
          }
        >
          <div className="space-y-3 p-4">
            <p className="text-[11px] text-muted-foreground">
              {p.origen === "prueba" ? t("admin.mejorasPruebas") : t("admin.mejorasFeedbackReal")} · {fecha(p.created_at)}
            </p>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{p.prompt}</pre>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(p.prompt).catch(() => {});
                  toast.success(t("admin.mejorasCopiado"));
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                <Copy className="size-3.5" />
                {t("admin.mejorasCopiar")}
              </button>
              {p.estado === "pendiente" || p.estado === "en_curso" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void cambiar(p, "descartada")}
                    className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    {t("admin.mejorasDescartar")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cambiar(p, "resuelta")}
                    className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                  >
                    {t("admin.mejorasResuelta")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void cambiar(p, "pendiente")}
                  className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  {t("admin.mejorasReabrir")}
                </button>
              )}
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
