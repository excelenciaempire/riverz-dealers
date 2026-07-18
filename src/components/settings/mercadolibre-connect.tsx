"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * MercadoLibre es por país (MLA/MLM/MLB/MCO/…): el login + consentimiento
 * viven en el dominio de auth del país del vendedor. UNA sola app de ML
 * autoriza vendedores de cualquier país — solo cambia ese host; la API y los
 * webhooks son globales. Por eso el merchant elige su país antes de conectar
 * y el backend arma la URL de autorización contra el dominio correcto.
 *
 * Los códigos coinciden con el mapa `mercadoLibreAuthHost` en lib/channels/oauth.
 */
const ML_COUNTRIES: { code: string; label: string }[] = [
  { code: "AR", label: "Argentina" },
  { code: "BR", label: "Brasil" },
  { code: "MX", label: "México" },
  { code: "CO", label: "Colombia" },
  { code: "CL", label: "Chile" },
  { code: "UY", label: "Uruguay" },
  { code: "PE", label: "Perú" },
  { code: "EC", label: "Ecuador" },
  { code: "BO", label: "Bolivia" },
  { code: "PY", label: "Paraguay" },
  { code: "CR", label: "Costa Rica" },
  { code: "PA", label: "Panamá" },
  { code: "DO", label: "Rep. Dominicana" },
  { code: "GT", label: "Guatemala" },
  { code: "VE", label: "Venezuela" },
];

export function MercadoLibreConnect({
  workspaceId,
  ready,
  anyConnected,
  busy,
}: {
  workspaceId: string;
  ready: boolean;
  anyConnected: boolean;
  busy: boolean;
}) {
  const t = useT();
  const [country, setCountry] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  if (!ready) {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        <AlertCircle className="size-4" />
        {t("settings.configureProvider")}
      </div>
    );
  }

  const connect = () => {
    // Antes el botón se deshabilitaba sin país y el clic "no hacía nada" (sin
    // feedback). Ahora siempre es clickeable y avisamos si falta elegir país.
    if (!country) {
      toast.error(t("settings.mlChooseCountryFirst"));
      return;
    }
    // Feedback inmediato: la ruta de start hace auth + chequeo de admin +
    // redirect del lado del servidor y puede tardar unos segundos (arranque en
    // frío), así que mostramos "Abriendo…" para que no parezca que no pasa nada.
    setRedirecting(true);
    window.location.assign(
      `/api/connections/mercadolibre/oauth/start?workspace_id=${workspaceId}&channel=mercadolibre&ml_country=${country}`,
    );
  };

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t("settings.mlCountryLabel")}
        </span>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full bg-transparent text-sm text-foreground outline-none"
        >
          <option value="" className="bg-card text-foreground">
            {t("settings.mlCountryPlaceholder")}
          </option>
          {ML_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} className="bg-card text-foreground">
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={connect}
        // Deshabilitado hasta elegir país: no se puede conectar sin país (y el
        // gris deja claro que falta ese paso). El spinner cubre la demora.
        disabled={busy || redirecting || !country}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60",
          !country
            ? "cursor-not-allowed border border-border bg-muted/40 text-muted-foreground"
            : anyConnected
              ? "border border-border bg-muted/50 text-foreground hover:bg-accent"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {redirecting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("settings.mlOpening")}
          </>
        ) : (
          <>
            <ChannelLogo channel="mercadolibre" size={16} />
            {anyConnected ? t("settings.addAnotherAccount") : t("settings.connect")}
          </>
        )}
      </button>
    </div>
  );
}
