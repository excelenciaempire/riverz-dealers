'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, Mail, Copy, Check } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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

export function ProfileForm() {
  const { user, profile, refreshProfile } = useAuth();
  const supabase = createClient();
  const t = useT();
  const fmt = useFormat();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailChangePending, setEmailChangePending] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

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
    previewUrl ?? (!removeAvatar ? profile?.avatar_url ?? null : null);

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
        t('settings.copiedToClipboard', { label: t('settings.userId') }),
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

    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profile.avatar_url ?? null;

      // Upload a newly-staged image, if any.
      if (pendingAvatar) {
        const ext =
          pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingAvatar, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) {
          throw new Error(t('settings.uploadFailed', { message: uploadError.message }));
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
          // Se guarda ya normalizado a dígitos: es lo que compara Meta cuando
          // vuelve la respuesta por WhatsApp.
          phone: trimmedPhone ? sanitizePhoneForMeta(trimmedPhone) : null,
        })
        .eq('user_id', user.id);
      if (updateError) {
        throw new Error(t('settings.saveFailed', { message: updateError.message }));
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
          toast.error(t('settings.emailChangeFailed', { message: emailError.message }));
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
        emailSent
          ? t('settings.savedEmailConfirm')
          : t('common.saved'),
      );
    } catch (err) {
      const msg = t('settings.genericError');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!profile &&
    (fullName.trim() !== (profile.full_name ?? '') ||
      email.trim().toLowerCase() !== (profile.email ?? '').toLowerCase() ||
      phone.trim() !== (profile.phone ?? '') ||
      pendingAvatar !== null ||
      removeAvatar);

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
        <CardTitle className="text-foreground">{t('settings.profileTitle')}</CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Avatar row */}
          <div className="flex flex-wrap items-center gap-5">
            <Avatar size="lg" className="size-16">
              {currentAvatar ? (
                <AvatarImage src={currentAvatar} alt={fullName || t('settings.avatarAlt')} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-base text-accent-ink">
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
                {currentAvatar ? t('settings.changePhoto') : t('settings.uploadPhoto')}
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
            <Input
              id="profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+54 9 11 5555 5555"
              maxLength={30}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t('settings.phoneHint')}</p>
          </div>

          {/* Read-only block */}
          <div className="rounded-lg border border-border bg-card/60 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings.accountData')}
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('settings.roleLabel')}</dt>
                <dd className="mt-0.5 font-mono text-foreground">
                  {profile?.role ?? 'user'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('settings.joinedOn')}</dt>
                <dd className="mt-0.5 text-foreground">{joined}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('settings.userId')}</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono text-xs text-muted-foreground">
                    {shortId ?? '—'}
                  </span>
                  {shortId && (
                    <button
                      type="button"
                      onClick={onCopyId}
                      aria-label={t('settings.userId')}
                      className="text-muted-foreground transition-colors hover:text-foreground"
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
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
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
