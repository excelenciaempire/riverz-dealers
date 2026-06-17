"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useTheme } from "@/hooks/use-theme";
import { useSetupStatus } from "@/hooks/use-setup-status";
import {
  Home,
  Inbox,
  Users,
  Megaphone,
  LayoutTemplate,
  Zap,
  Sparkles,
  Blocks,
  Settings,
  ShoppingBag,
  Workflow,
  LogOut,
  User,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  UserRound,
  BarChart3,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InstagramIcon } from "@/components/layout/instagram-icon";

interface NavItem {
  href: string;
  label: string;
  /** Acepta iconos de lucide y componentes propios (p. ej. el glifo de
   *  Instagram) — todos respetan el contrato `{ className }`. */
  icon: ComponentType<{ className?: string }>;
  beta?: boolean;
  alsoActiveOn?: string[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// IA-first sidebar: "Día a día" arriba (operación), "IA y constructor"
// (las dos herramientas que crean experiencias), "Envíos" (los tres
// surfaces de outbound consolidados), "Tienda" (catálogo) y abajo
// configuración. Antes "Atención" mezclaba IA con outbound asíncrono,
// que es lo opuesto. Antes "Menús" no estaba en el rail; ahora es
// "Flujos" y es item raíz.
const navGroups: NavGroup[] = [
  {
    title: "Día a día",
    items: [
      { href: "/panel", label: "Inicio", icon: Home },
      { href: "/bandeja", label: "Bandeja", icon: Inbox },
      { href: "/contactos", label: "Contactos", icon: Users },
    ],
  },
  {
    title: "Servicio al cliente",
    items: [
      { href: "/asistente", label: "Asistente IA", icon: Sparkles },
      { href: "/menus", label: "Flujos", icon: Workflow },
    ],
  },
  {
    title: "Instagram",
    items: [
      { href: "/agente-instagram", label: "Agente de Instagram", icon: InstagramIcon, beta: true },
    ],
  },
  {
    title: "Envíos",
    items: [
      { href: "/campanas", label: "Campañas", icon: Megaphone },
      { href: "/automatizaciones", label: "Automatizaciones", icon: Zap },
      { href: "/plantillas", label: "Plantillas", icon: LayoutTemplate },
    ],
  },
  {
    title: "Tienda",
    items: [
      { href: "/productos", label: "Productos", icon: ShoppingBag },
    ],
  },
  {
    title: "Análisis",
    items: [
      { href: "/metricas", label: "Métricas", icon: BarChart3 },
    ],
  },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
  /** Desktop-only — when true, sidebar shrinks to an icon-only rail. */
  collapsed?: boolean;
  /** Fired when the user clicks the collapse/expand toggle inside the
   *  sidebar. Mirrors the same toggle in the header. */
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Recombinar pathname + ?param=valor para que NavLink pueda
  // distinguir entre /ajustes (general) y /ajustes?tab=workspace
  // (Equipo). Antes ambos se activaban juntos.
  const fullPath = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const { theme, setTheme } = useTheme();
  const setup = useSetupStatus();

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Mobile backdrop. */}
      <button
        type="button"
        aria-label="Cerrar menú"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-[width] lg:duration-200",
          collapsed ? "lg:w-16" : "lg:w-60",
        )}
        aria-label="Principal"
      >
        {/* Logo row — lowercase lime wordmark, matching Riverz. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center justify-between gap-2",
            collapsed ? "px-4 lg:justify-center lg:px-2" : "px-4",
          )}
        >
          <Link
            href="/panel"
            aria-label="riverz"
            className={cn(
              "text-[20px] font-semibold lowercase leading-none tracking-[0.04em] text-sidebar-primary",
              collapsed && "lg:hidden",
            )}
          >
            riverz
          </Link>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="rounded-md p-1 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Desktop collapse / expand toggle. Centered when collapsed so the
              icon rail keeps a usable expand control. */}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
              title={collapsed ? "Expandir menú" : "Contraer menú"}
              className={cn(
                "hidden rounded-md p-1 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block",
                collapsed && "lg:mx-auto",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Main navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto py-3 scrollbar-thin",
            collapsed ? "lg:px-2" : "px-3",
          )}
        >
          {navGroups.map((group) => (
            <div key={group.title} className="mb-4">
              <h3
                className={cn(
                  "app-sidebar-group mb-1.5 px-2.5",
                  collapsed && "lg:hidden",
                )}
              >
                {group.title}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname} fullPath={fullPath}
                    collapsed={collapsed}
                    totalUnread={totalUnread}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Pie del sidebar: Equipo (promovido desde Ajustes porque es
            tarea de la primera semana), Integraciones (con badge
            pendiente hasta que WhatsApp y Shopify estén conectados) y
            Ajustes (perfil, workspace, apariencia). */}
        <div
          className={cn(
            "flex flex-col gap-0.5 border-t border-sidebar-border py-2",
            collapsed ? "lg:px-2" : "px-3",
          )}
        >
          <NavLink
            item={{ href: "/ajustes?tab=workspace", label: "Equipo", icon: UserRound }}
            pathname={pathname} fullPath={fullPath}
            collapsed={collapsed}
            totalUnread={0}
          />
          <NavLink
            item={{
              href: "/integraciones",
              label: "Integraciones",
              icon: Blocks,
            }}
            pathname={pathname} fullPath={fullPath}
            collapsed={collapsed}
            totalUnread={0}
            setupPending={!setup.ready}
          />
          <NavLink
            item={{ href: "/ajustes", label: "Ajustes", icon: Settings }}
            pathname={pathname} fullPath={fullPath}
            collapsed={collapsed}
            totalUnread={0}
          />
        </div>

        {/* User row + theme toggle */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-t border-sidebar-border p-3",
            collapsed && "lg:flex-col lg:gap-2 lg:p-2",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex min-w-0 flex-1 items-center rounded-lg text-left transition-colors hover:bg-sidebar-accent focus:bg-sidebar-accent focus:outline-none data-popup-open:bg-sidebar-accent",
                collapsed ? "lg:justify-center lg:p-1.5" : "gap-2.5 px-2 py-1.5",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/15 text-sm font-medium text-sidebar-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                <p className="truncate text-[13px] font-medium text-sidebar-foreground">
                  {profile?.full_name ?? "Usuario"}
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/55">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/ajustes?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/ajustes"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                Ajustes
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Light / dark toggle — mirrors Riverz's sidebar control. */}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={
              theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
            }
            title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-sidebar-border text-sidebar-foreground/60 transition-colors hover:border-sidebar-primary hover:text-sidebar-primary"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

function NavLink({
  item,
  pathname,
  fullPath,
  collapsed,
  totalUnread,
  setupPending = false,
}: {
  item: NavItem;
  pathname: string;
  /** pathname + ?param=valor. Permite distinguir entre items que
   *  comparten pathname pero difieren en tab (ej. Equipo vs Ajustes). */
  fullPath: string;
  collapsed: boolean;
  totalUnread: number;
  /** Cuando Integraciones todavía no tiene WhatsApp+Shopify conectados,
   *  mostramos un chip "Conecta" para guiar el onboarding. */
  setupPending?: boolean;
}) {
  // Lógica de activo:
  //   1) Si el item.href tiene "?tab=X", es "qualified": solo se activa
  //      cuando el fullPath actual coincide exactamente con item.href.
  //      Antes Equipo (/ajustes?tab=workspace) y Ajustes (/ajustes) se
  //      activaban juntos porque ambos hacían pathname.startsWith
  //      ("/ajustes").
  //   2) Si el item.href NO tiene "?", se activa por prefix del pathname
  //      (comportamiento original — Bandeja activa para /bandeja/abc, etc.).
  //   3) Items "generales" (sin tab) NO se activan cuando hay un tab que
  //      apunta a su mismo pathname; si no, Ajustes se activaría también
  //      cuando estoy en /ajustes?tab=workspace.
  const itemPath = item.href.split("?")[0];
  const itemHasTab = item.href.includes("?");
  const currentTab = fullPath.includes("?")
    ? fullPath.split("?")[1]
    : null;
  let isActive = false;
  if (itemHasTab) {
    // Qualified: match exacto contra fullPath.
    isActive = fullPath === item.href;
  } else if (item.href === "/panel") {
    isActive = pathname === "/panel";
  } else {
    // General: pathname start with itemPath PERO solo si no hay un tab
    // en la URL actual (porque en ese caso el item "qualified" gana).
    const pathMatches = pathname === itemPath || pathname.startsWith(itemPath + "/");
    isActive = pathMatches && !currentTab;
  }
  if (
    !isActive &&
    item.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    isActive = true;
  }

  const showUnreadBadge =
    item.href === "/bandeja" && totalUnread > 0 && !isActive;
  const unreadLabel = totalUnread > 99 ? "99+" : String(totalUnread);

  const link = (
    <Link
      href={item.href}
      className={cn(
        "app-sidebar-link",
        collapsed && "lg:justify-center lg:px-0",
        isActive && "is-active",
      )}
    >
      <item.icon className="h-3.5 w-3.5 shrink-0" />
      <span className={cn("flex-1", collapsed && "lg:hidden")}>
        {item.label}
      </span>
      {item.beta && !collapsed && (
        <span
          aria-label="Función Beta"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
        >
          Beta
        </span>
      )}
      {setupPending && !collapsed && (
        <span
          aria-label="Falta conectar WhatsApp o Shopify"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
        >
          Conecta
        </span>
      )}
      {showUnreadBadge && !collapsed && (
        <span
          aria-label={`${totalUnread} sin leer`}
          className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-semibold leading-none text-sidebar-primary-foreground"
        >
          {unreadLabel}
        </span>
      )}
      {showUnreadBadge && collapsed && (
        <span
          aria-label={`${totalUnread} sin leer`}
          className="absolute right-1 top-1 inline-flex min-w-[14px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-semibold leading-none text-sidebar-primary-foreground lg:flex"
        >
          {unreadLabel}
        </span>
      )}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}
