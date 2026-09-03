'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/hooks/use-locale';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PasswordForm() {
  const { user } = useAuth();
  const t = useT();
  const supabase = createClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.email) return;

    if (password.length < 8) {
      toast.error(t('settings.passwordMin8'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('settings.passwordsDontMatch'));
      return;
    }

    setSaving(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) {
        toast.error(t('settings.currentPasswordIncorrect'));
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(t('settings.passwordChangeFailed'));
        return;
      }

      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
      toast.success(t('settings.passwordChanged'));
    } catch {
      toast.error(t('settings.passwordChangeFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border bg-card/40">
      <CardHeader>
        <CardTitle className="text-foreground">
          {t('settings.passwordTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password" className="text-foreground">
              {t('settings.currentPasswordLabel')}
            </Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              disabled={saving || !user?.email}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-foreground">
              {t('settings.newPasswordLabel')}
            </Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              disabled={saving || !user?.email}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-new-password" className="text-foreground">
              {t('settings.confirmNewPasswordLabel')}
            </Label>
            <Input
              id="confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              disabled={saving || !user?.email}
              required
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !user?.email}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('settings.changePassword')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
