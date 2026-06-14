"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useTheme } from "@/hooks/use-theme";
import {
  LayoutDashboard,
  Inbox,
  Users,
  Megaphone,
  LayoutTemplate,
  Zap,
  Sparkles,
  Blocks,
  Settings,
  ShoppingBag,
  LogOut,
  User,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
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

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Renders a small "Beta" chip after the label. Informational only. */
  beta?: boolean;
  /** Extra path prefixes that should also light up this item — used by
   *  "Servicio al cliente" so /flows highlights it as well as /ai. */
  alsoActiveOn?: string[];
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Grouped navigation, mirroring Riverz's sidebar sections. Group labels
// render as tiny uppercase eyebrows above each cluster.
const navGroups: NavGroup[] = [
  {
    title: "Principal",
    items: [
      { href: "/panel", label: "Panel", icon: LayoutDashboard },
      { href: "/bandeja", label: "Bandeja", icon: Inbox },
      { href: "/contactos", label: "Contactos", icon: Users },
    ],
  },
  {
    title: "Atención",
    items: [
      {
        href: "/asistente",
        label: "Servicio al cliente",
        icon: Sparkles,
        alsoActiveOn: ["/menus"],
      },
      { href: "/automatizaciones", label: "Automatizaciones", icon: Zap },
    ],
  },
  {
    title: "Marketing",
    items: [
      { href: "/campanas", label: "Campañas masivas", icon: Megaphone },
      { href: "/plantillas", label: "Plantillas de WhatsApp", icon: LayoutTemplate },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { href: "/productos", label: "Productos", icon: ShoppingBag },
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
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const { theme, setTheme } = useTheme();

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
                    pathname={pathname}
                    collapsed={collapsed}
                    totalUnread={totalUnread}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Configuración: Integraciones (canales y apps externas) + Ajustes
            (perfil, equipo, etiquetas, apariencia). Antes Integraciones
            era un deep-link a /settings?tab=channels — ahora es su propia
            página. */}
        <div
          className={cn(
            "flex flex-col gap-0.5 border-t border-sidebar-border py-2",
            collapsed ? "lg:px-2" : "px-3",
          )}
        >
          <NavLink
            item={{
              href: "/integraciones",
              label: "Integraciones",
              icon: Blocks,
            }}
            pathname={pathname}
            collapsed={collapsed}
            totalUnread={0}
          />
          <NavLink
            item={{ href: "/ajustes", label: "Ajustes", icon: Settings }}
            pathname={pathname}
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
  collapsed,
  totalUnread,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  totalUnread: number;
}) {
  const isActive =
    pathname === item.href ||
    (item.href !== "/panel" && pathname.startsWith(item.href)) ||
    (item.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(p)) ?? false);

  const showUnreadDot = item.href === "/bandeja" && totalUnread > 0 && !isActive;

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
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
        >
          Beta
        </span>
      )}
      {showUnreadDot && (
        <span
          aria-label={`${totalUnread} conversación${totalUnread === 1 ? "" : "es"} sin leer`}
          className={cn(
            "relative flex h-2 w-2",
            collapsed && "lg:absolute lg:right-1 lg:top-1",
          )}
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sidebar-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sidebar-primary" />
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
