"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CHANNELS, type Channel } from "@/types";

/**
 * Quién atiende qué.
 *
 * El motor de asignación existe desde la migración 032 y corre en cada mensaje
 * que entra: rota entre personas, o manda a alguien por canal, por etiqueta o
 * por una palabra del primer mensaje. Nunca tuvo pantalla — se podían crear
 * reglas por API y no había forma de verlas, así que en la práctica el reparto
 * era manual y el motor no hacía nada.
 *
 * Va acá, debajo del equipo, porque la pregunta es la misma: quién trabaja en
 * esta bandeja y con qué le toca.
 */

type Tipo = "round_robin" | "by_channel" | "by_keyword" | "by_tag";

interface Regla {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  kind: Tipo;
  config: {
    agent_id?: string;
    agent_ids?: string[];
    channel?: string;
    keyword?: string;
    tag_id?: string;
  };
}

interface Miembro {
  user_id: string;
  nombre: string;
}

const TIPOS: { valor: Tipo; clave: string }[] = [
  { valor: "round_robin", clave: "settings.ruleRoundRobin" },
  { valor: "by_channel", clave: "settings.ruleByChannel" },
  { valor: "by_keyword", clave: "settings.ruleByKeyword" },
  { valor: "by_tag", clave: "settings.ruleByTag" },
];

export function AssignmentRulesPanel({
  workspaceId,
  miembros,
}: {
  workspaceId: string;
  miembros: Miembro[];
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [etiquetas, setEtiquetas] = useState<{ id: string; name: string }[]>([]);
  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<Tipo>("round_robin");
  const [persona, setPersona] = useState("");
  const [canal, setCanal] = useState<Channel>("whatsapp");
  const [palabra, setPalabra] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [rotan, setRotan] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/inbox/assignment-rules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo) setReglas((j?.rules ?? []) as Regla[]);
      })
      .catch(() => {
        if (vivo) setReglas([]);
      });
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo) setEtiquetas((j?.tags ?? []) as { id: string; name: string }[]);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const recargar = async () => {
    const res = await fetch("/api/inbox/assignment-rules", { cache: "no-store" }).catch(
      () => null,
    );
    const json = res && res.ok ? await res.json() : null;
    setReglas((json?.rules ?? []) as Regla[]);
  };

  const guardar = async (patch: Partial<Regla> & { id?: string }) => {
    setGuardando(true);
    try {
      const res = await fetchWithCsrf("/api/inbox/assignment-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, ...patch }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await recargar();
      return true;
    } catch {
      toast.error(t("settings.ruleSaveFailed"));
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const crear = async () => {
    const name = nombre.trim();
    if (!name) return;
    // Cada tipo necesita lo suyo, y se comprueba acá: una regla a la que le
    // falta el destinatario se guarda igual y después no asigna nada, que es
    // la peor forma de fallar — en silencio y semanas después.
    const config: Regla["config"] =
      tipo === "round_robin"
        ? { agent_ids: rotan }
        : tipo === "by_channel"
          ? { channel: canal, agent_id: persona }
          : tipo === "by_keyword"
            ? { keyword: palabra.trim(), agent_id: persona }
            : { tag_id: etiqueta, agent_id: persona };
    if (tipo === "round_robin" ? rotan.length === 0 : !persona) return;
    if (tipo === "by_keyword" && !palabra.trim()) return;
    if (tipo === "by_tag" && !etiqueta) return;

    const ok = await guardar({
      name,
      kind: tipo,
      is_active: true,
      priority: (reglas?.length ?? 0) + 1,
      config,
    });
    if (ok) {
      setNombre("");
      setPalabra("");
      setRotan([]);
      setCreando(false);
    }
  };

  const borrar = async (id: string) => {
    const res = await fetchWithCsrf(
      `/api/inbox/assignment-rules?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ).catch(() => null);
    if (!res?.ok) {
      toast.error(t("settings.ruleSaveFailed"));
      return;
    }
    await recargar();
  };

  const nombreDe = (userId?: string) =>
    miembros.find((m) => m.user_id === userId)?.nombre ?? "—";

  /** Una línea que dice qué hace la regla, sin abrirla. */
  const describir = (r: Regla): string => {
    if (r.kind === "round_robin") {
      return t("settings.ruleRotatesAmong", { n: (r.config.agent_ids ?? []).length });
    }
    if (r.kind === "by_channel") {
      return `${r.config.channel ?? "—"} → ${nombreDe(r.config.agent_id)}`;
    }
    if (r.kind === "by_keyword") {
      return `"${r.config.keyword ?? ""}" → ${nombreDe(r.config.agent_id)}`;
    }
    const et = etiquetas.find((e) => e.id === r.config.tag_id)?.name ?? "—";
    return `${et} → ${nombreDe(r.config.agent_id)}`;
  };

  if (reglas === null) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div>
      {reglas.length === 0 && !creando ? (
        <p className="text-xs text-muted-foreground">{t("settings.ruleEmpty")}</p>
      ) : null}

      {reglas.length > 0 ? (
        <ul className="divide-y divide-border">
          {reglas.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <Switch
                checked={r.is_active}
                onCheckedChange={(v) => void guardar({ ...r, is_active: v })}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    r.is_active
                      ? "text-sm font-medium text-foreground"
                      : "text-sm font-medium text-muted-foreground"
                  }
                >
                  {r.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {describir(r)}
                </p>
              </div>
              <button
                type="button"
                aria-label={r.name}
                onClick={() => void borrar(r.id)}
                className="text-muted-foreground transition hover:text-foreground"
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
            value={nombre}
            maxLength={60}
            placeholder={t("settings.ruleNamePlaceholder")}
            onChange={(e) => setNombre(e.target.value)}
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Tipo)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {TIPOS.map((x) => (
              <option key={x.valor} value={x.valor}>
                {t(x.clave)}
              </option>
            ))}
          </select>

          {tipo === "round_robin" ? (
            <div className="grid grid-cols-2 gap-1.5">
              {miembros.map((m) => (
                <label
                  key={m.user_id}
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={rotan.includes(m.user_id)}
                    onChange={(e) =>
                      setRotan((prev) =>
                        e.target.checked
                          ? [...prev, m.user_id]
                          : prev.filter((x) => x !== m.user_id),
                      )
                    }
                  />
                  {m.nombre}
                </label>
              ))}
            </div>
          ) : (
            <>
              {tipo === "by_channel" ? (
                <select
                  value={canal}
                  onChange={(e) => setCanal(e.target.value as Channel)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : null}
              {tipo === "by_keyword" ? (
                <Input
                  value={palabra}
                  maxLength={60}
                  placeholder={t("settings.ruleKeywordPlaceholder")}
                  onChange={(e) => setPalabra(e.target.value)}
                />
              ) : null}
              {tipo === "by_tag" ? (
                <select
                  value={etiqueta}
                  onChange={(e) => setEtiqueta(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">—</option>
                  {etiquetas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">{t("settings.rulePickPerson")}</option>
                {miembros.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={guardando || !nombre.trim()}>
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreando(false)}>
              {t("common.cancel")}
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
          <span className="ml-1.5">{t("settings.ruleAdd")}</span>
        </Button>
      )}
    </div>
  );
}
