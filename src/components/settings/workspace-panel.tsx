"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Clock,
  Loader2,
  Mail,
  Trash2,
  UserPlus,
  ShieldCheck,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import { useFormat } from "@/hooks/use-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/use-workspace";
import { cacheWorkspaceTimezone } from "@/hooks/use-timezone";
import { DEFAULT_TIMEZONE, listTimeZones } from "@/lib/timezones";
import { GATEABLE_SECTIONS } from "@/lib/rbac/sections";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { featureForPath, isFeatureEnabled } from "@/lib/admin/feature-flags";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Profile, WorkspaceInvite, WorkspaceMember } from "@/types";
import { invitesOpen } from "@/lib/auth/signups";

export function WorkspacePanel() {
  const { workspace, isAdmin, loading, reload } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const fmt = useFormat();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [savingTz, setSavingTz] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"agent" | "admin">("agent");
  const [inviting, setInviting] = useState(false);
  // El rol y el acceso se eligen en el diálogo que abre el botón Invitar.
  const [inviteOpen, setInviteOpen] = useState(false);
  // RBAC: acceso al menú que lleva la invitación (null = acceso total).
  // Arranca en [] y no en null a propósito: el diálogo abre con la lista de
  // secciones a la vista y nada marcado, así que invitar exige decidir a qué
  // entra la persona. Con "Acceso completo" por defecto, dar acceso a todo era
  // lo que pasaba por no tocar nada.
  const [inviteAllowed, setInviteAllowed] = useState<string[] | null>([]);
  // Per-member access editor (which member's access is open + its draft).
  const [accessEdit, setAccessEdit] = useState<{ id: string; value: string[] | null } | null>(null);
  const [savingAccess, setSavingAccess] = useState(false);
  // Igual que el de miembros, pero para una invitación que todavía no se
  // aceptó: quien invitó puede corregir rol y secciones sin revocar y volver a
  // mandar el correo.
  const [inviteEdit, setInviteEdit] = useState<{
    id: string;
    role: "admin" | "agent";
    value: string[] | null;
  } | null>(null);
  const [savingInvite, setSavingInvite] = useState(false);

  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setTimezone(workspace.timezone ?? DEFAULT_TIMEZONE);
    }
  }, [workspace]);

  const fetchMembersAndInvites = useCallback(async () => {
    if (!workspace) return;
    const supabase = createClient();
    // El perfil se trae aparte a propósito: workspace_members.user_id apunta a
    // auth.users, no a profiles, así que no hay FK que PostgREST pueda embeber.
    // Pedirlo con `profiles!...fkey(...)` devolvía error y la lista quedaba vacía.
    const [membersRes, invitesRes, authRes] = await Promise.all([
      supabase
        .from("workspace_members")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("workspace_invites")
        .select("*")
        .eq("workspace_id", workspace.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
      supabase.auth.getUser(),
    ]);
    const rows = (membersRes.data ?? []) as WorkspaceMember[];
    const userIds = [...new Set(rows.map((m) => m.user_id).filter(Boolean))];
    const { data: profileRows } = userIds.length
      ? await supabase.from("profiles").select("*").in("user_id", userIds)
      : { data: [] as Profile[] };
    const byUser = new Map((profileRows ?? []).map((p) => [p.user_id as string, p as Profile]));
    setCurrentUserId(authRes.data.user?.id ?? null);
    setMembers(rows.map((m) => ({ ...m, user: byUser.get(m.user_id) })));
    setInvites((invitesRes.data ?? []) as WorkspaceInvite[]);
  }, [workspace]);

  useEffect(() => {
    void fetchMembersAndInvites();
  }, [fetchMembersAndInvites]);

  const handleRename = useCallback(async () => {
    if (!workspace) return;
    if (!name.trim() || name === workspace.name) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("workspaces")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq("id", workspace.id);
    setSaving(false);
    if (error) {
      toast.error(t("settings.genericError"));
      return;
    }
    toast.success(t("settings.workspaceRenamed"));
    reload();
  }, [workspace, name, reload, t]);

  const handleSaveTimezone = useCallback(async () => {
    if (!workspace) return;
    if (timezone === (workspace.timezone ?? DEFAULT_TIMEZONE)) return;
    setSavingTz(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("workspaces")
      .update({ timezone, updated_at: new Date().toISOString() })
      .eq("id", workspace.id);
    setSavingTz(false);
    if (error) {
      toast.error(t("settings.genericError"));
      return;
    }
    // Prime the cache so the inbox + dashboard pick up the new zone on the
    // next navigation instead of flashing the old cached value.
    cacheWorkspaceTimezone(timezone);
    toast.success(t("settings.timezoneUpdated"));
    reload();
  }, [workspace, timezone, reload, t]);

  const handleInvite = useCallback(async () => {
    if (!workspace || !inviteEmail.trim()) return;
    setInviting(true);
    const res = await fetchWithCsrf("/api/workspace/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspace.id,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        // Admins are always full-access; agents carry the assigned sections.
        allowed_sections: inviteRole === "agent" ? inviteAllowed : null,
      }),
    });
    setInviting(false);
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      accept_url?: string;
      mail_delivered?: boolean;
    };
    if (!res.ok) {
      toast.error(payload.error ?? t("settings.inviteError"));
      return;
    }
    // Si el correo no salió (cuota de Supabase, SMTP sin configurar), la
    // invitación existe igual: se copia el enlace para mandarlo a mano en vez
    // de dejar al admin creyendo que ya llegó.
    if (payload.mail_delivered === false && payload.accept_url) {
      await navigator.clipboard?.writeText(payload.accept_url).catch(() => {});
      toast.success(t("settings.inviteLinkCopied"));
    } else {
      toast.success(t("settings.inviteSent", { email: inviteEmail }));
    }
    setInviteEmail("");
    setInviteRole("agent");
    setInviteAllowed([]);
    setInviteOpen(false);
    await fetchMembersAndInvites();
  }, [workspace, inviteEmail, inviteRole, inviteAllowed, fetchMembersAndInvites, fetchWithCsrf, t]);

  const handleSaveAccess = useCallback(async () => {
    if (!accessEdit) return;
    setSavingAccess(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("workspace_members")
      .update({ allowed_sections: accessEdit.value })
      .eq("id", accessEdit.id);
    setSavingAccess(false);
    if (error) {
      toast.error(t("settings.genericError"));
      return;
    }
    toast.success(t("settings.accessUpdated"));
    setAccessEdit(null);
    await fetchMembersAndInvites();
  }, [accessEdit, fetchMembersAndInvites, t]);

  const handleRemoveMember = useCallback(
    async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("workspace_members").delete().eq("id", id);
      if (error) {
        toast.error(t("settings.genericError"));
        return;
      }
      toast.success(t("settings.memberRemoved"));
      await fetchMembersAndInvites();
    },
    [fetchMembersAndInvites, t],
  );

  const handleChangeRole = useCallback(
    async (id: string, role: "admin" | "agent") => {
      const supabase = createClient();
      const { error } = await supabase.from("workspace_members").update({ role }).eq("id", id);
      if (error) {
        toast.error(t("settings.genericError"));
        return;
      }
      await fetchMembersAndInvites();
    },
    [fetchMembersAndInvites, t],
  );

  const handleSaveInviteAccess = useCallback(async () => {
    if (!inviteEdit) return;
    setSavingInvite(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("workspace_invites")
      .update({
        role: inviteEdit.role,
        // Un admin no se restringe por secciones: su rol ya implica todo.
        allowed_sections: inviteEdit.role === "agent" ? inviteEdit.value : null,
      })
      .eq("id", inviteEdit.id);
    setSavingInvite(false);
    if (error) {
      toast.error(t("settings.genericError"));
      return;
    }
    toast.success(t("settings.accessUpdated"));
    setInviteEdit(null);
    await fetchMembersAndInvites();
  }, [inviteEdit, fetchMembersAndInvites, t]);

  const handleRevokeInvite = useCallback(
    async (id: string) => {
      const supabase = createClient();
      await supabase.from("workspace_invites").delete().eq("id", id);
      await fetchMembersAndInvites();
    },
    [fetchMembersAndInvites],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("settings.noWorkspace")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workspace card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Building2 className="size-5 text-accent-ink" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.workspace")}</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("settings.nameLabel")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              className="bg-muted text-foreground"
            />
          </div>
          {isAdmin && (
            <Button
              onClick={handleRename}
              disabled={saving || !name.trim() || name === workspace.name}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
            </Button>
          )}
        </div>

        {/* Timezone — the single app reporting zone. Governs the "día" of
            every metric (panel, gráficas, uso mensual) AND the hours shown
            in the inbox, so the whole team agrees on the numbers. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              {t("settings.timezoneLabel")}
            </Label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!isAdmin || savingTz}
              className="flex h-9 w-full rounded-md border border-border bg-muted px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {listTimeZones().map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <Button
              onClick={handleSaveTimezone}
              disabled={
                savingTz ||
                timezone === (workspace.timezone ?? DEFAULT_TIMEZONE)
              }
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingTz ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("settings.timezoneHint")}
        </p>
      </section>

      {/* Members card */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{t("settings.teamMembers")}</h2>
        </div>
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const user = (m as WorkspaceMember & { user?: { full_name: string; email: string; avatar_url?: string } })
              .user;
            const isYou = m.user_id === currentUserId;
            return (
              <li key={m.id} className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                    {user?.full_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {user?.full_name ?? user?.email ?? t("settings.memberPending")}
                      {isYou && <span className="ml-2 text-xs text-muted-foreground">{t("settings.memberYou")}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                  {isAdmin ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleChangeRole(m.id, e.target.value as "admin" | "agent")}
                      className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                    >
                      <option value="admin">{t("settings.roleAdmin")}</option>
                      <option value="agent">{t("settings.roleAgent")}</option>
                    </select>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {m.role === "admin" ? <ShieldCheck className="size-3" /> : <Shield className="size-3" />}
                      {m.role === "admin" ? t("settings.roleAdmin") : t("settings.roleAgent")}
                    </span>
                  )}
                  {/* Menu access — only agents can be restricted; admins are full. */}
                  {isAdmin && m.role === "agent" && (
                    <button
                      onClick={() =>
                        setAccessEdit(
                          accessEdit?.id === m.id
                            ? null
                            : { id: m.id, value: m.allowed_sections ?? null },
                        )
                      }
                      className="rounded-md p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={t("settings.menuAccess")}
                      title={t("settings.menuAccess")}
                    >
                      <SlidersHorizontal className="size-4" />
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      className="rounded-md p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground transition-colors hover:bg-accent hover:text-red-700 dark:hover:text-red-400"
                      aria-label={t("settings.removeMember")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {isAdmin && m.role === "agent" && accessEdit?.id === m.id && (
                  <div className="mt-3">
                    <SectionAccessEditor
                      value={accessEdit.value}
                      onChange={(v) => setAccessEdit({ id: m.id, value: v })}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setAccessEdit(null)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveAccess}
                        disabled={savingAccess}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {savingAccess ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Invitar equipo: sigue disponible en prelanzamiento (el registro
            público está cerrado, sumar compañeros no). */}
        {isAdmin && invitesOpen() && (
          <div className="border-t border-border px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <UserPlus className="size-4 text-accent-ink" />
              {t("settings.invite")}
            </h3>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                if (inviteEmail.trim()) setInviteOpen(true);
              }}
            >
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("settings.invitePlaceholder")}
                className="bg-muted text-foreground"
              />
              <Button
                type="submit"
                disabled={!inviteEmail.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("settings.invite")}
              </Button>
            </form>
          </div>
        )}
      </section>

      {/* Acceso de la invitación — rol + secciones antes de enviar. */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.inviteAccessTitle", { email: inviteEmail })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("settings.roleLabel")}</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "agent")}
                className="flex h-9 w-full rounded-md border border-border bg-muted px-3 text-sm text-foreground"
              >
                <option value="agent">{t("settings.roleAgent")}</option>
                <option value="admin">{t("settings.roleAdmin")}</option>
              </select>
            </div>
            {inviteRole === "agent" && (
              <SectionAccessEditor value={inviteAllowed} onChange={setInviteAllowed} />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleInvite}
              disabled={inviting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {inviting ? <Loader2 className="size-4 animate-spin" /> : t("settings.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{t("settings.pendingInvites")}</h2>
          </div>
          <ul className="divide-y divide-border">
            {invites.map((inv) => (
              <li key={inv.id} className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <Mail className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.inviteRoleExpires", {
                        role:
                          inv.role === "admin"
                            ? t("settings.roleAdmin")
                            : t("settings.roleAgent"),
                        date: fmt.date(inv.expires_at),
                      })}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() =>
                        setInviteEdit(
                          inviteEdit?.id === inv.id
                            ? null
                            : {
                                id: inv.id,
                                role: inv.role === "admin" ? "admin" : "agent",
                                value: inv.allowed_sections ?? null,
                              },
                        )
                      }
                      className="rounded-md p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={t("settings.menuAccess")}
                      title={t("settings.menuAccess")}
                    >
                      <SlidersHorizontal className="size-4" />
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => handleRevokeInvite(inv.id)}
                      className="rounded-md p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground transition-colors hover:bg-accent hover:text-red-700 dark:hover:text-red-400"
                      aria-label={t("settings.revokeInvite")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                {isAdmin && inviteEdit?.id === inv.id && (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("settings.roleLabel")}
                      </Label>
                      <select
                        value={inviteEdit.role}
                        onChange={(e) =>
                          setInviteEdit({
                            ...inviteEdit,
                            role: e.target.value as "admin" | "agent",
                          })
                        }
                        className="flex h-9 w-full rounded-md border border-border bg-muted px-3 text-sm text-foreground"
                      >
                        <option value="agent">{t("settings.roleAgent")}</option>
                        <option value="admin">{t("settings.roleAdmin")}</option>
                      </select>
                    </div>
                    {inviteEdit.role === "agent" && (
                      <SectionAccessEditor
                        value={inviteEdit.value}
                        onChange={(v) => setInviteEdit({ ...inviteEdit, value: v })}
                      />
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setInviteEdit(null)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveInviteAccess}
                        disabled={savingInvite}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {savingInvite ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          t("common.save")
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Menu-access picker: a "full access" toggle + a checklist of the gateable
 *  sidebar sections. `value == null` means full access. */
function SectionAccessEditor({
  value,
  onChange,
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const t = useT();
  const { flags } = useFeatureFlags();
  const full = value == null;
  const selected = new Set(value ?? []);

  // Una funcionalidad apagada desde el panel de plataforma no se ofrece acá:
  // dar acceso a una sección que nadie puede abrir solo confunde. Se filtra
  // para todos, también para el equipo Riverz — el bypass de platform admin
  // sirve para probar la app, no para repartir permisos que no aplican.
  //
  // Ojo: se filtra lo que se MUESTRA, no lo guardado. Si un miembro ya tenía
  // "/menus" concedido y Flujos se apaga, la clave sobrevive en su fila y el
  // permiso vuelve intacto el día que se reactive.
  const sections = GATEABLE_SECTIONS.filter((s) => {
    const feature = featureForPath(s.key);
    return !feature || isFeatureEnabled(flags, feature);
  });
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          {t("settings.menuAccess")}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => onChange(e.target.checked ? null : [])}
          />
          {t("settings.menuAccessFull")}
        </label>
      </div>
      {!full && (
        <>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("settings.menuAccessHint")}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
            {sections.map((s) => (
              <label
                key={s.key}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.key)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.key);
                    else next.delete(s.key);
                    onChange([...next]);
                  }}
                />
                {t(s.labelKey)}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
