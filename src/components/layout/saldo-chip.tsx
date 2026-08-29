"use client";

import Link from "@/components/i18n/locale-link";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { useSaldo } from "@/hooks/use-saldo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * El saldo en el menú, visible desde cualquier pantalla.
 *
 * Hasta ahora el número vivía en Ajustes → Saldo y sólo salía a la luz cuando
 * llegaba a cero, en forma de cartel. Eso es enterarse tarde: para cuando el
 * cartel aparece, la IA ya dejó de responderle a alguien. Acá está siempre, en
 * el pie del menú, con el color diciendo lo único que hace falta decidir —si
 * hay que recargar o no— y un clic que lleva justo a recargar.
 *
 * Tres estados y nada más:
 *   normal      — alcanza. Gris, como el resto del menú: no compite con nada.
 *   por caer    — por debajo del umbral. Ámbar, para que se note sin asustar.
 *   en cero     — ya apaga o está por apagar. Rojo.
 *
 * La cuenta de **cortesía** ve el número pero nunca lo ve en rojo ni en ámbar:
 * tiene saldo y lo gasta, así que esconderlo sería mentirle, pero a ella no se
 * le apaga nada al llegar a cero y pintarle una alarma sería un susto inventado.
 * Si además nunca cargó nada, no se muestra: cero sin nada que decir es ruido.
 */
export function SaldoChip({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const { saldo } = useSaldo();

  if (!saldo) return null;
  if (saldo.exenta && saldo.centavos <= 0) return null;

  const enCero = !saldo.exenta && saldo.centavos <= 0;
  // Con tarjeta y recarga automática el saldo se repone solo antes de llegar
  // al umbral: pintar de ámbar algo que ya está resuelto es ruido.
  const porCaer =
    !saldo.exenta &&
    !enCero &&
    !saldo.autoConTarjeta &&
    saldo.centavos < saldo.umbralCentavos;

  const monto = fmt.currency(
    saldo.centavos / 100,
    (saldo.moneda || "usd").toUpperCase(),
  );

  const color = enCero
    ? "text-destructive"
    : porCaer
      ? "text-amber-600 dark:text-amber-400"
      : "text-sidebar-foreground";

  const fila = (
    <Link
      href="/ajustes?tab=saldo"
      onClick={onNavigate}
      aria-label={`${t("nav.balance")}: ${monto}`}
      className={cn(
        "app-sidebar-link",
        "min-h-[44px] lg:min-h-0",
        collapsed && "lg:justify-center lg:px-0",
      )}
    >
      <Wallet
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          (enCero || porCaer) && color,
        )}
      />
      <span className={cn("flex-1", collapsed && "lg:hidden")}>
        {t("nav.balance")}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          color,
          collapsed && "lg:hidden",
        )}
      >
        {monto}
      </span>
    </Link>
  );

  if (!collapsed) return fila;

  return (
    <Tooltip>
      <TooltipTrigger render={fila} />
      <TooltipContent side="right" sideOffset={8}>
        {t("nav.balance")}: {monto}
      </TooltipContent>
    </Tooltip>
  );
}
