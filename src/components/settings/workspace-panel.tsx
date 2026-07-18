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
  Activity,
  AlertTriangle,
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
import type { WorkspaceInvite, WorkspaceMember } from "@/types";

interface UsageData {
  messages_sent: number;
  ai_replies: number;
  period_start: string;
}

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
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"agent" | "admin">("agent");
  const [inviting, setInviting] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setTimezone(workspace.timezone ?? DEFAULT_TIMEZONE);
    }
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
    const res = await fetchWithCsrf("/api/workspaces/delete", {
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
      toast.error(payload.error ?? t("settings.workspaceDeleteError"));
      return;
    }
    toast.success(t("settings.workspaceDeleted"));
    window.location.href = "/ingresar";
  }, [workspace, deleteConfirm, fetchWithCsrf, t]);

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
      }),
    });
    setInviting(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error ?? t("settings.inviteError"));
      return;
    }
    toast.success(t("settings.inviteSent", { email: inviteEmail }));
    setInviteEmail("");
    await fetchMembersAndInvites();
  }, [workspace, inviteEmail, inviteRole, fetchMembersAndInvites, fetchWithCsrf, t]);

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
            const isYou = false;
            return (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
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
                {isAdmin && (
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    className="ml-2 rounded-md p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
                    aria-label={t("settings.removeMember")}
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
              {t("settings.invite")}
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("settings.invitePlaceholder")}
                className="bg-muted text-foreground"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "agent")}
                className="rounded-md border border-border bg-muted px-2 text-sm text-foreground"
              >
                <option value="agent">{t("settings.roleAgent")}</option>
                <option value="admin">{t("settings.roleAdmin")}</option>
              </select>
              <Button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {inviting ? <Loader2 className="size-4 animate-spin" /> : t("settings.send")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Usage card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Activity className="size-5 text-accent-ink" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.monthlyUsage")}</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("settings.messagesSent")}
            </p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {usage ? fmt.number(usage.messages_sent) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("settings.aiReplies")}
            </p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {usage ? fmt.number(usage.ai_replies) : "—"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("settings.usageHint")}
        </p>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{t("settings.pendingInvites")}</h2>
          </div>
          <ul className="divide-y divide-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
                <Mail className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.inviteRoleExpires", {
                      role: inv.role === "admin" ? t("settings.roleAdmin") : t("settings.roleAgent"),
                      date: fmt.date(inv.expires_at),
                    })}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="rounded-md p-1 flex items-center justify-center min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 text-muted-foreground transition-colors hover:bg-accent hover:text-red-400"
                    aria-label={t("settings.revokeInvite")}
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
              {t("settings.deleteWorkspacePermanently")}
            </h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("settings.deleteWorkspaceWarning")}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={t("settings.deleteWorkspaceConfirmPlaceholder", { name: workspace.name })}
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
                t("settings.deleteWorkspace")
              )}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
