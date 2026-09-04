'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, Mail, Copy, Check, Plus } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { CampoTelefono } from '@/components/ui/campo-telefono';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  countryOfPhone,
  sanitizePhoneForMeta,
  isValidE164,
  normalizeToWhatsApp,
} from '@/lib/whatsapp/phone-utils';
import type { CountryCode } from 'libphonenumber-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { AlertDestinationScope } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

// Rough email shape check — the real validator is Supabase Auth, which
// rejects anything malformed when we call updateUser({ email }). We
// just want to stop obvious typos before making a network call.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type AlertNumber = { phone: string; scope: AlertDestinationScope };

function parseLegacyAlertNumber(value: string): AlertNumber {
  const match = /^(escalations|notifications|both)::(.+)$/.exec(value);
  return match
    ? { scope: match[1] as AlertDestinationScope, phone: match[2] }
    : { scope: 'both', phone: value };
}

/**
 * Cuántos números extra se pueden cargar.
 *
 * Cuatro más el propio son cinco. Con más que eso el aviso deja de ser un aviso
 * y pasa a ser una difusión, y lo que se difunde se ignora.
 */
const MAX_EXTRA = 4;

export function ProfileForm() {
  const { user, profile, refreshProfile } = useAuth();
  const supabase = createClient();
  const t = useT();
  const fmt = useFormat();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  /**
   * Los otros números a los que Riverz avisa.
   *
   * Son del ESPACIO DE TRABAJO y no de este perfil —el aviso es de la cuenta,
   * no de quien la está mirando— pero se editan acá porque acá está el teléfono
   * que la persona ya conoce. Buscarlos en otra pestaña era encontrarlos por
   * casualidad.
   */
  const [primaryScope, setPrimaryScope] =
    useState<AlertDestinationScope>('both');
  const [extras, setExtras] = useState<AlertNumber[]>([]);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailChangePending, setEmailChangePending] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

  /** El país del teléfono propio: los extra suelen ser del mismo lugar. */
  const paisDelPropio = useMemo(() => {
    const iso = phone.trim() ? countryOfPhone(phone) : null;
    return (iso as CountryCode | null) ?? 'CO';
  }, [phone]);

  // Los números extra viven en el espacio de trabajo. Se leen aparte del perfil
  // porque son de otra tabla, y se escriben con el mismo botón Guardar: para
  // quien los edita son la misma cosa.
  const { workspace, isAdmin, reload: reloadWorkspace } = useWorkspace();
  useEffect(() => {
    if (!workspace || !profile) return;
    const w = workspace as unknown as {
      alert_phones?: string[] | null;
      alert_destinations?: AlertNumber[] | null;
    };
    const propios = (
      w.alert_destinations?.length
        ? w.alert_destinations
        : (w.alert_phones ?? []).map(parseLegacyAlertNumber)
    ).filter((x) => x.phone);
    const propio = sanitizePhoneForMeta(profile.phone ?? '');
    const principal = propios.find(
      (x) => sanitizePhoneForMeta(x.phone) === propio
    );
    setPrimaryScope(principal?.scope ?? 'both');
    setExtras(propios.filter((x) => sanitizePhoneForMeta(x.phone) !== propio));
  }, [workspace, profile]);

  // Seed form state once the profile loads.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setEmail(profile.email ?? '');
    setPhone(profile.phone ?? '');
  }, [profile]);

  // Cleanup object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentAvatar =
    previewUrl ?? (!removeAvatar ? (profile?.avatar_url ?? null) : null);

  const initial = (fullName || profile?.full_name || profile?.email || 'U')
    .charAt(0)
    .toUpperCase();

  // El UUID completo sólo importa para soporte: se muestra el prefijo y
  // el botón copia el ID entero.
  const shortId = user?.id ? user.id.slice(0, 8) : null;

  const onCopyId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setIdCopied(true);
      toast.success(
        t('settings.copiedToClipboard', { label: t('settings.userId') })
      );
      setTimeout(() => setIdCopied(false), 1500);
    } catch {
      toast.error(t('settings.couldNotCopy'));
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error(t('settings.avatarInvalidType'));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('settings.avatarTooLarge'));
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error(t('settings.nameMissing'));
      return;
    }
    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      toast.error(t('settings.emailInvalid'));
      return;
    }
    // Vacío es válido (nadie está obligado a dar el teléfono); lo que no vale
    // es uno que WhatsApp no pueda marcar, porque el aviso se perdería en
    // silencio, que es justo el modo de falla que se está arreglando.
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !isValidE164(sanitizePhoneForMeta(trimmedPhone))) {
      toast.error(t('settings.phoneInvalid'));
      return;
    }
    // Los extra, con la misma vara: uno inválido guardado es un aviso perdido
    // en silencio, que es justo el modo de falla que se está arreglando.
    const extraMalo = extras
      .map((x) => x.phone.trim())
      .filter(Boolean)
      .find((x) => !isValidE164(sanitizePhoneForMeta(x)));
    if (extraMalo) {
      toast.error(t('settings.phoneInvalid'));
      return;
    }

    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profile.avatar_url ?? null;

      // Upload a newly-staged image, if any.
      if (pendingAvatar) {
        const ext = pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingAvatar, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) {
          throw new Error(
            t('settings.uploadFailed', { message: uploadError.message })
          );
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from('avatars').getPublicUrl(path);
        nextAvatarUrl = publicUrl;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      // Persist name + avatar to profiles. (Timezone is workspace-level now —
      // set in Ajustes → Espacio de trabajo.)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          avatar_url: nextAvatarUrl,
          // Normalizado al formato que marca WhatsApp, no a dígitos pelados:
          // en Argentina un móvil sin el `9` es inalcanzable, y el campo deja
          // escribirlo de las dos formas porque las dos se ven bien.
          phone: trimmedPhone ? normalizeToWhatsApp(trimmedPhone) : null,
        })
        .eq('user_id', user.id);
      if (updateError) {
        throw new Error(
          t('settings.saveFailed', { message: updateError.message })
        );
      }

      // Y los números extra del espacio de trabajo, si esta persona puede.
      // Se guardan normalizados igual que el propio: un número con el prefijo
      // a medias es un aviso que no llega y que nadie va a poder explicar.
      if (isAdmin && workspace) {
        const destinos = [
          ...(trimmedPhone
            ? [
                {
                  phone: normalizeToWhatsApp(trimmedPhone),
                  scope: primaryScope,
                },
              ]
            : []),
          ...extras
            .map((x) => ({ phone: x.phone.trim(), scope: x.scope }))
            .filter(Boolean)
            .map((x) => ({ ...x, phone: normalizeToWhatsApp(x.phone) })),
        ];
        const sinDuplicados = [
          ...new Map(
            destinos.map((x) => [sanitizePhoneForMeta(x.phone), x])
          ).values(),
        ];
        const { error: wsError } = await supabase
          .from('workspaces')
          .update({
            alert_destinations: sinDuplicados,
            updated_at: new Date().toISOString(),
          })
          .eq('id', workspace.id);
        if (wsError) {
          // Durante el despliegue la aplicación puede actualizarse unos
          // segundos antes que la migración. Conservamos el mismo dato en el
          // campo anterior, con el alcance prefijado, para no bloquear a quien
          // está configurando guardias justo en ese momento.
          if (!wsError.message.includes('alert_destinations')) {
            throw new Error(
              t('settings.saveFailed', { message: wsError.message })
            );
          }
          const { error: legacyError } = await supabase
            .from('workspaces')
            .update({
              alert_phones: sinDuplicados.map(
                (x) => `${x.scope}::${x.phone}`
              ),
              updated_at: new Date().toISOString(),
            })
            .eq('id', workspace.id);
          if (legacyError) {
            throw new Error(
              t('settings.saveFailed', { message: legacyError.message })
            );
          }
        }
        // No esperar a que la consulta del workspace vuelva a terminar para
        // repintar la lista: de otro modo el número sí queda en la base pero
        // la pantalla muestra una fila vacía durante el refresco.
        setExtras(
          sinDuplicados.filter(
            (x) =>
              sanitizePhoneForMeta(x.phone) !==
              sanitizePhoneForMeta(trimmedPhone)
          )
        );
        reloadWorkspace();
      }

      // Email change goes through Supabase Auth, which emails a
      // confirmation to both the old and new addresses. We don't
      // touch profiles.email — Supabase will push the change there
      // after the user clicks the link (handled by the handle_new_user
      // trigger pattern in production deployments).
      let emailSent = false;
      if (trimmedEmail.toLowerCase() !== profile.email.toLowerCase()) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: trimmedEmail,
        });
        if (emailError) {
          // Partial success: name/avatar saved but email didn't.
          toast.success(t('common.saved'));
          toast.error(
            t('settings.emailChangeFailed', { message: emailError.message })
          );
          setSaving(false);
          await refreshProfile();
          return;
        }
        emailSent = true;
      }

      setEmailChangePending(emailSent);
      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();

      toast.success(
        emailSent ? t('settings.savedEmailConfirm') : t('common.saved')
      );
    } catch (err) {
      // El motivo REAL, no un genérico.
      //
      // `err` se atrapaba y se descartaba: todo fallo —RLS, columna, red— salía
      // como "Ocurrió un error", y arriba se construyen mensajes concretos
      // (`settings.saveFailed` con el texto de la base) que nunca llegaban a
      // verse. Con eso, "no me deja guardar" no se podía diagnosticar ni
      // mirando la pantalla (2026-08-29).
      toast.error(
        err instanceof Error ? err.message : t('settings.genericError')
      );
      console.error('[perfil] no se pudo guardar:', err);
    } finally {
      setSaving(false);
    }
  };

  const savedDestinations =
    (
      workspace as unknown as {
        alert_destinations?: AlertNumber[] | null;
        alert_phones?: string[] | null;
      } | null
    )?.alert_destinations ??
    (
      (workspace as unknown as { alert_phones?: string[] | null } | null)
        ?.alert_phones ?? []
    ).map(parseLegacyAlertNumber);
  const savedPrimaryScope =
    savedDestinations.find(
      (x) =>
        sanitizePhoneForMeta(x.phone) ===
        sanitizePhoneForMeta(profile?.phone ?? '')
    )?.scope ?? 'both';
  const savedExtras = savedDestinations
    .filter(
      (x) =>
        sanitizePhoneForMeta(x.phone) !==
        sanitizePhoneForMeta(profile?.phone ?? '')
    )
    .map((x) => ({ phone: sanitizePhoneForMeta(x.phone), scope: x.scope }));

  const dirty =
    !!profile &&
    (fullName.trim() !== (profile.full_name ?? '') ||
      email.trim().toLowerCase() !== (profile.email ?? '').toLowerCase() ||
      // Por dígitos, no por texto.
      //
      // El campo emite «+5491161047646» y la base guarda «5491161047646»: son
      // el mismo número y la comparación cruda decía que no. El botón quedaba
      // gris para quien SÍ había cambiado algo —o encendido para siempre para
      // quien no— según de qué lado estuviera el `+`.
      sanitizePhoneForMeta(phone) !==
        sanitizePhoneForMeta(profile.phone ?? '') ||
      primaryScope !== savedPrimaryScope ||
      pendingAvatar !== null ||
      removeAvatar ||
      JSON.stringify(
        extras
          .map((x) => ({
            phone: sanitizePhoneForMeta(x.phone),
            scope: x.scope,
          }))
          .filter((x) => x.phone)
      ) !== JSON.stringify(savedExtras));

  const joined = user?.created_at
    ? fmt.date(user.created_at, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  return (
    <Card className="bg-card/40 border-border">
      <CardHeader>
        <CardTitle className="text-foreground">
          {t('settings.profileTitle')}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Avatar row */}
          <div className="flex flex-wrap items-center gap-5">
            <Avatar size="lg" className="size-16">
              {currentAvatar ? (
                <AvatarImage
                  src={currentAvatar}
                  alt={fullName || t('settings.avatarAlt')}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-accent-ink text-base">
                {initial}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <Upload className="size-4" />
                {currentAvatar
                  ? t('settings.changePhoto')
                  : t('settings.uploadPhoto')}
              </Button>
              {currentAvatar && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onRemoveAvatar}
                  disabled={saving}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                  {t('common.remove')}
                </Button>
              )}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="profile-full-name" className="text-foreground">
              {t('settings.displayName')}
            </Label>
            <Input
              id="profile-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              disabled={saving}
              required
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="profile-email" className="text-foreground">
              {t('settings.emailLabel')}
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
              required
            />
            {emailChangePending && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <Mail className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t('settings.emailChangePendingNotice', {
                    oldEmail: profile?.email ?? '',
                    newEmail: email,
                  })}
                </span>
              </p>
            )}
          </div>

          {/* Teléfono: es a donde Riverz pregunta lo que no decide solo. */}
          <div className="space-y-2">
            <Label htmlFor="profile-phone" className="text-foreground">
              {t('settings.phoneLabel')}
            </Label>
            <div className="flex items-center gap-2">
              <CampoTelefono
                id="profile-phone"
                value={phone}
                onChange={setPhone}
                disabled={saving}
                className="flex-1"
              />
              <select
                value={primaryScope}
                onChange={(e) =>
                  setPrimaryScope(e.target.value as AlertDestinationScope)
                }
                disabled={saving || !phone.trim()}
                className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm disabled:opacity-50"
                aria-label={t('settings.alertScopeLabel')}
              >
                <option value="both">{t('settings.alertScopeBoth')}</option>
                <option value="escalations">
                  {t('settings.alertScopeEscalations')}
                </option>
                <option value="notifications">
                  {t('settings.alertScopeNotifications')}
                </option>
              </select>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('settings.phoneHint')}
            </p>

            {/* Los otros números a los que avisamos.
                Son del espacio de trabajo y no de este perfil, pero se editan
                acá porque acá está el teléfono que la persona ya conoce. En
                otra pestaña se encontraban por casualidad. */}
            {isAdmin && (
              <div className="space-y-2 pt-1">
                {extras.map((destino, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CampoTelefono
                      id={`extra-phone-${i}`}
                      value={destino.phone}
                      onChange={(v) =>
                        setExtras((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, phone: v } : x))
                        )
                      }
                      paisPorDefecto={paisDelPropio}
                      disabled={saving}
                      className="flex-1"
                    />
                    <select
                      value={destino.scope}
                      onChange={(e) =>
                        setExtras((prev) =>
                          prev.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  scope: e.target
                                    .value as AlertDestinationScope,
                                }
                              : x
                          )
                        )
                      }
                      disabled={saving}
                      className="border-input bg-background text-foreground h-9 rounded-md border px-2 text-sm disabled:opacity-50"
                      aria-label={t('settings.alertScopeLabel')}
                    >
                      <option value="both">
                        {t('settings.alertScopeBoth')}
                      </option>
                      <option value="escalations">
                        {t('settings.alertScopeEscalations')}
                      </option>
                      <option value="notifications">
                        {t('settings.alertScopeNotifications')}
                      </option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setExtras((prev) => prev.filter((_, j) => j !== i))
                      }
                      disabled={saving}
                      className="border-border text-muted-foreground hover:text-destructive rounded-lg border p-2 transition-colors disabled:opacity-50"
                      aria-label={t('settings.phoneRemove')}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                {extras.length < MAX_EXTRA && (
                  <button
                    type="button"
                    onClick={() =>
                      setExtras((prev) => [
                        ...prev,
                        { phone: '', scope: 'both' },
                      ])
                    }
                    disabled={saving}
                    className="text-accent-ink inline-flex items-center gap-1.5 text-xs font-medium hover:underline disabled:opacity-50"
                  >
                    <Plus className="size-3.5" />
                    {t('settings.phoneAdd')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Read-only block */}
          <div className="border-border bg-card/60 rounded-lg border p-4">
            <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
              {t('settings.accountData')}
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">
                  {t('settings.roleLabel')}
                </dt>
                <dd className="text-foreground mt-0.5 font-mono">
                  {profile?.role ?? 'user'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t('settings.joinedOn')}
                </dt>
                <dd className="text-foreground mt-0.5">{joined}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t('settings.userId')}
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-muted-foreground font-mono text-xs">
                    {shortId ?? '—'}
                  </span>
                  {shortId && (
                    <button
                      type="button"
                      onClick={onCopyId}
                      aria-label={t('settings.userId')}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {idCopied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {!profile && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty || !profile}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t('common.save')
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
