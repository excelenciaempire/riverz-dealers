"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Loader2,
  Mail,
  Trash2,
  UserPlus,
  ShieldCheck,
  Shield,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/use-workspace";
import type { WorkspaceInvite, WorkspaceMember } from "@/types";

interface UsageData {
  messages_sent: number;
  ai_replies: number;
  period_start: string;
}

export function WorkspacePanel() {
  const { workspace, isAdmin, loading, reload } = useWorkspace();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"agent" | "admin">("agent");
  const [inviting, setInviting] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (workspace) setName(workspace.name);
  }, [workspace]);

  const fetchMembersAndInvites = useCallback(async () => {
    if (!workspace) return;
    const supabase = createClient();
    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from("workspace_members")
        .select("*, user:profiles!workspace_members_user_id_fkey(full_name, email, avatar_url)")
        .eq("workspace_id", workspace.id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("workspace_invites")
        .select("*")
        .eq("workspace_id", workspace.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    setMembers((membersRes.data ?? []) as WorkspaceMember[]);
    setInvites((invitesRes.data ?? []) as WorkspaceInvite[]);
  }, [workspace]);

  useEffect(() => {
    void fetchMembersAndInvites();
  }, [fetchMembersAndInvites]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/workspaces/usage?workspace_id=${encodeURIComponent(workspace.id)}`,
      );
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as UsageData;
      if (!cancelled) setUsage(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!workspace) return;
    setDeleting(true);
    const res = await fetch("/api/workspaces/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspace.id,
        confirm_name: deleteConfirm,
      }),
    });
    setDeleting(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error ?? "No se pudo eliminar el espacio de trabajo");
      return;
    }
    toast.success("Espacio de trabajo eliminado");
    window.location.href = "/ingresar";
  }, [workspace, deleteConfirm]);

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
      toast.error(error.message);
      return;
    }
    toast.success("Espacio de trabajo renombrado");
    reload();
  }, [workspace, name, reload]);

  const handleInvite = useCallback(async () => {
    if (!workspace || !inviteEmail.trim()) return;
    setInviting(true);
    const res = await fetch("/api/workspace/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspace.id,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      }),
    });
    setInviting(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error ?? "No se pudo enviar la invitación");
      return;
    }
    toast.success(`Invitación enviada a ${inviteEmail}`);
    setInviteEmail("");
    await fetchMembersAndInvites();
  }, [workspace, inviteEmail, inviteRole, fetchMembersAndInvites]);

  const handleRemoveMember = useCallback(
    async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("workspace_members").delete().eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Miembro eliminado");
      await fetchMembersAndInvites();
    },
    [fetchMembersAndInvites],
  );

  const handleChangeRole = useCallback(
    async (id: string, role: "admin" | "agent") => {
      const supabase = createClient();
      const { error } = await supabase.from("workspace_members").update({ role }).eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      await fetchMembersAndInvites();
    },
    [fetchMembersAndInvites],
  );

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
        Sin espacio de trabajo. Vuelve a iniciar sesión.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workspace card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Building2 className="size-5 text-accent-ink" />
          <h2 className="text-base font-semibold text-foreground">Espacio de trabajo</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nombre</Label>
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
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Guardar"}
            </Button>
          )}
        </div>
      </section>

      {/* Members card */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">Miembros del equipo</h2>
        </div>
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const user = (m as WorkspaceMember & { user?: { full_name: string; email: string; avatar_url?: string } })
              .user;
            const isYou = false;
            return (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                  {user?.full_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {user?.full_name ?? user?.email ?? "Pendiente"}
                    {isYou && <span className="ml-2 text-xs text-muted-foreground">(tú)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
                {isAdmin ? (
                  <select
                    value={m.role}
                    onChange={(e) => handleChangeRole(m.id, e.target.value as "admin" | "agent")}
                    className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    <option value="admin">Administrador</option>
                    <option value="agent">Agente</option>
                  </select>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {m.role === "admin" ? <ShieldCheck className="size-3" /> : <Shield className="size-3" />}
                    {m.role === "admin" ? "Administrador" : "Agente"}
                  </span>
                )}
                {isAdmin && (
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    className="ml-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
                    aria-label="Eliminar miembro"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {/* Invite form */}
        {isAdmin && (
          <div className="border-t border-border px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <UserPlus className="size-4 text-accent-ink" />
              Invitar
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="compañero@email.com"
                className="bg-muted text-foreground"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "agent")}
                className="rounded-md border border-border bg-muted px-2 text-sm text-foreground"
              >
                <option value="agent">Agente</option>
                <option value="admin">Administrador</option>
              </select>
              <Button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {inviting ? <Loader2 className="size-4 animate-spin" /> : "Enviar"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Usage card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Activity className="size-5 text-accent-ink" />
          <h2 className="text-base font-semibold text-foreground">Uso del mes</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Mensajes enviados
            </p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {usage ? usage.messages_sent.toLocaleString("es-ES") : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Respuestas de IA
            </p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {usage ? usage.ai_replies.toLocaleString("es-ES") : "—"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Contadores del mes calendario actual (UTC).
        </p>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">Invitaciones pendientes</h2>
          </div>
          <ul className="divide-y divide-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
                <Mail className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Rol: {inv.role === "admin" ? "Administrador" : "Agente"} · expira el {new Date(inv.expires_at).toLocaleDateString('es-ES')}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
                    aria-label="Revocar invitación"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Danger zone — workspace deletion. Only the owner sees it. */}
      {isAdmin && (
        <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-500" />
            <h2 className="text-base font-semibold text-foreground">
              Eliminar workspace permanentemente
            </h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            El espacio se ocultará de inmediato para todo el equipo. La
            depuración real de datos personales corre como un proceso aparte.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={`Escribe "${workspace.name}" para confirmar`}
              className="bg-card text-foreground"
            />
            <Button
              onClick={handleDeleteWorkspace}
              disabled={deleting || deleteConfirm.trim() !== workspace.name}
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Eliminar workspace"
              )}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
