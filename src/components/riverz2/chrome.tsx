"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/i18n/locale-link";
import { canonicalizePath } from "@/lib/i18n/routes";
import { LogOut, Moon, Settings, Sun, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useT } from "@/hooks/use-locale";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * El chrome de Riverz 2.0: tres pestañas arriba y nada más.
 *
 * Es lo único que separa las dos aplicaciones. Con el flag apagado nunca se
 * monta y la barra lateral de siempre queda intacta; con el flag prendido, la
 * barra de pestañas se dibuja ENCIMA del mismo árbol de rutas — por eso la
 * pestaña de editar muestra la aplicación completa sin duplicar una sola
 * pantalla.
 *
 * La barra lateral sólo aparece en la pestaña de editar. En el chat estorbaría:
 * la conversación es la pantalla, no un panel dentro de otra cosa.
 */

export type Riverz2Tab = "chat" | "panel" | "bandeja" | "editar" | "ajustes";

/**
 * Las cinco superficies.
 *
 * Chat es la casa. Panel es todo lo que hay que mirar. Bandeja y Ajustes son
 * pestañas propias porque son destinos, no secciones: al equipo la bandeja le
 * lleva el día entero, y a los ajustes se entra desde cualquier lado. Editar es
 * el resto — lo que el chat construye y a veces hay que retocar a mano.
 */
const TABS: { tab: Riverz2Tab; href: string; label: string; prefijo: string }[] = [
  { tab: "chat", href: "/chat", label: "riverz2.tabChat", prefijo: "/chat" },
  { tab: "panel", href: "/operacion", label: "riverz2.tabPanel", prefijo: "/operacion" },
  { tab: "bandeja", href: "/bandeja", label: "riverz2.tabInbox", prefijo: "/bandeja" },
  // Entra por las automatizaciones: es lo que el chat más arma, así que es lo
  // que más se va a querer retocar.
  { tab: "editar", href: "/automatizaciones", label: "riverz2.tabEdit", prefijo: "" },
  { tab: "ajustes", href: "/ajustes", label: "riverz2.tabSettings", prefijo: "/ajustes" },
];

/**
 * Integraciones cuenta como Ajustes.
 *
 * Conectar canales y tiendas es configurar la cuenta, no editar lo que el chat
 * armó. Es su propia pantalla —es grande— pero la pestaña que se prende es la
 * de Ajustes, para que no parezca que te fuiste a otro lado.
 */
const EN_AJUSTES = ["/integraciones"];

/** A qué pestaña pertenece una ruta. Lo que no cae en ninguna es editar. */
export function tabForPath(path: string): Riverz2Tab {
  const p = canonicalizePath(path).split("?")[0];
  if (EN_AJUSTES.some((x) => p === x || p.startsWith(`${x}/`))) return "ajustes";
  for (const x of TABS) {
    if (x.prefijo && (p === x.prefijo || p.startsWith(`${x.prefijo}/`))) return x.tab;
  }
  return "editar";
}

/** Las que ocupan la pantalla entera, sin barra lateral. */
const SIN_BARRA: Riverz2Tab[] = ["chat", "panel", "bandeja", "ajustes"];

export function Riverz2Chrome({
  children,
  sidebar,
}: {
  children: React.ReactNode;
  /** La barra lateral de siempre. Sólo se pinta en la pestaña de editar. */
  sidebar: React.ReactNode;
}) {
  const activa = tabForPath(usePathname());
  const enChat = activa === "chat";
  // La bandeja trae su propio armazón de tres columnas y su propio scroll: con
  // el relleno de las otras pantallas queda encajonada.
  const aBorde = enChat || activa === "bandeja";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TabBar activa={activa} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!SIN_BARRA.includes(activa) && sidebar}
        <main
          className={cn(
            "min-w-0 flex-1",
            aBorde ? "overflow-hidden" : "overflow-y-auto p-4 sm:p-6 lg:p-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function TabBar({ activa }: { activa: Riverz2Tab }) {
  const t = useT();
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-3 sm:px-4">
      <Link
        href="/chat"
        aria-label="riverz"
        className="shrink-0 text-[19px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink"
      >
        riverz
      </Link>

      <nav className="flex min-w-0 flex-1 items-center gap-1">
        {TABS.map((x) => (
          <Link
            key={x.tab}
            href={x.href}
            aria-current={activa === x.tab ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              activa === x.tab
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(x.label)}
          </Link>
        ))}
      </nav>

      <AccountMenu />
    </header>
  );
}

/**
 * Cuenta y tema, que en la aplicación de siempre viven al pie de la barra
 * lateral. Acá tienen que estar en la barra de arriba porque en el chat y en el
 * panel no hay barra lateral donde ponerlos.
 */
function AccountMenu() {
  const { profile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const t = useT();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label={theme === "dark" ? t("nav.switchToLight") : t("nav.switchToDark")}
        className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-full focus:outline-none">
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? "Avatar"} />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-sm font-medium text-accent-ink">
              {profile?.full_name?.charAt(0)?.toUpperCase() ??
                profile?.email?.charAt(0)?.toUpperCase() ??
                "U"}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
          <DropdownMenuItem render={<Link href="/ajustes?tab=profile" />}>
            <User className="size-4" />
            {t("nav.profile")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/ajustes" />}>
            <Settings className="size-4" />
            {t("nav.settings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="size-4" />
            {t("nav.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
